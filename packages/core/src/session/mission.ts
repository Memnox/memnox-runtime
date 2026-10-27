import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { DECISION_EFFECT } from '../constants/decision.constants';
import type { MemnoxEvent } from '../event/event';
import {
  describeSpan,
  IN_SECONDS_THEN_MINUTES_THEN_HOURS,
} from '../domain/duration-text';
import { exclusively } from '../store/exclusive';
import { JsonRecordDir } from '../store/json-records';
import { outcomesFrom } from './replay';
import { summarizeSession } from './session-summary';
import { strainOf } from './strain';

/**
 * One goal worked on across many sessions: an agent running through a queue for hours, a
 * fix that took three runs, a nested agent started by another. A session is one process;
 * a mission is what somebody asked for, so "what has it been doing all afternoon" has a unit.
 */

export const MISSION_DIR = 'missions';

/** Carried to every process a run starts, so a nested run joins the same mission. */
export const MISSION_VAR = 'MEMNOX_MISSION';

const MISSION_ID = /^msn_[0-9a-f]{8}$/;

export interface Mission {
  id: string;
  /** In the words the person used. */
  statement: string;
  /** What it answers to, such as an incident or a ticket, typed by a person and never guessed. */
  reference?: string;
  startedAt: string;
  closedAt?: string;
  /** Oldest first, each session at most once. */
  sessions: string[];
  /**
   * The repository it was started in. A session working there or in one of its worktrees while
   * the mission is open is part of it, which is how workers an orchestrator starts join.
   */
  root?: string;
}

/** Where a session runs and since when, as the hooks recorded it. */
export interface SessionPlace {
  sessionId: string;
  cwd?: string;
  seenAt: string;
}

/** Checked before an id becomes a file name, since an id is typed by a person. */
export function isMissionId(id: string): boolean {
  return MISSION_ID.test(id);
}

export function missionDirFor(home: string): string {
  return join(home, MEMNOX_HOME, MISSION_DIR);
}

export class Missions {
  private readonly records: JsonRecordDir<Mission>;

  constructor(private readonly home: string) {
    this.records = new JsonRecordDir(missionDirFor(home));
  }

  /** Every run of an orchestrator joins at once, and each join rewrites the mission. */
  private locked<T>(work: () => Promise<T>): Promise<T> {
    return exclusively(missionDirFor(this.home), work);
  }

  async start(
    statement: string,
    options: { reference?: string; root?: string; now: string },
  ): Promise<Mission> {
    const mission: Mission = {
      id: `msn_${randomBytes(4).toString('hex')}`,
      statement,
      ...(options.reference === undefined ? {} : { reference: options.reference }),
      ...(options.root === undefined ? {} : { root: options.root }),
      startedAt: options.now,
      sessions: [],
    };
    await this.records.write(mission.id, mission);
    return mission;
  }

  /** Null for an id that is not one, as well as for one nothing was written under. */
  read(id: string): Promise<Mission | null> {
    return isMissionId(id) ? this.records.read(id) : Promise.resolve(null);
  }

  /** Newest first, since the one somebody is asking about is almost always the latest. */
  async all(): Promise<Mission[]> {
    const found = await this.records.all();
    return found.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** The mission a session belongs to, or null for the ordinary session that joined none. */
  async ofSession(sessionId: string): Promise<Mission | null> {
    const found = await this.records.all();
    return found.find((mission) => mission.sessions.includes(sessionId)) ?? null;
  }

  /** Refused for a closed mission, since work joined to a finished goal is a new goal. */
  attach(id: string, sessionId: string): Promise<Mission> {
    return this.locked(() => this.join(id, sessionId));
  }

  private async join(id: string, sessionId: string): Promise<Mission> {
    const mission = await this.read(id);
    if (mission === null)
      throw new Error(`no mission ${id}; "memnox mission list" shows them`);
    if (mission.closedAt !== undefined) {
      throw new Error(`mission ${id} was closed, so start a new one for this work`);
    }
    if (mission.sessions.includes(sessionId)) return mission;
    const joined = { ...mission, sessions: [...mission.sessions, sessionId] };
    await this.records.write(id, joined);
    return joined;
  }

  close(id: string, now: string): Promise<Mission> {
    return this.locked(() => this.finish(id, now));
  }

  private async finish(id: string, now: string): Promise<Mission> {
    const mission = await this.read(id);
    if (mission === null)
      throw new Error(`no mission ${id}; "memnox mission list" shows them`);
    if (mission.closedAt !== undefined) return mission;
    const closed = { ...mission, closedAt: now };
    await this.records.write(id, closed);
    return closed;
  }
}

/**
 * Where one session of a mission stands, so one that failed is seen beside the ones that did
 * not rather than taking the whole mission with it. `clear` is nothing failing, stopped or
 * waiting, which is not the same as finished: only the agent knows that, and it is never guessed.
 */
export const SESSION_STANDING = {
  CLEAR: 'clear',
  WAITING: 'waiting',
  FAILING: 'failing',
  STOPPED: 'stopped',
  NOT_STARTED: 'not started',
} as const;

export type SessionStanding = (typeof SESSION_STANDING)[keyof typeof SESSION_STANDING];

/** What the ledger alone cannot say about a session: a question still open, a breaker holding it. */
export interface MissionState {
  waiting?: ReadonlySet<string>;
  stopped?: ReadonlySet<string>;
}

/**
 * Sessions that worked in the repository or its worktrees while it was open, since an
 * orchestrator's workers start in tmux or a gateway and never pass through `memnox run`.
 */
export function withWorkersOf(
  mission: Mission,
  places: readonly SessionPlace[],
  roots: readonly string[],
): Mission {
  if (roots.length === 0) return mission;
  const found = places
    .filter(
      (place) =>
        place.cwd !== undefined &&
        roots.some((root) => isInside(place.cwd ?? '', root)) &&
        place.seenAt >= mission.startedAt &&
        (mission.closedAt === undefined || place.seenAt < mission.closedAt),
    )
    .sort((a, b) => a.seenAt.localeCompare(b.seenAt))
    .map((place) => place.sessionId)
    .filter((sessionId) => !mission.sessions.includes(sessionId));
  return found.length === 0
    ? mission
    : { ...mission, sessions: [...mission.sessions, ...found] };
}

/** `src/billing` holds `src/billing/a.ts` and not `src/billing-legacy`, the sibling prefix trap. */
function isInside(path: string, root: string): boolean {
  const base = root.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
}

/** A mission added up from the ledger, over every session it holds. Counts, never a score. */
export interface MissionSummary {
  mission: Mission;
  sessions: number;
  /** From the first row recorded to the last, absent before any work was. */
  firstAt?: string;
  lastAt?: string;
  actions: number;
  filesChanged: number;
  outsideChanges: number;
  /** Failures the same work later got past. */
  recovered: number;
  /** Failing commands nothing has got past yet. */
  failing: string[];
  held: number;
  refused: number;
  /** Allowed by a person who was asked. */
  approved: number;
  /** Each session's standing, in the order they joined. */
  standings: { sessionId: string; standing: SessionStanding }[];
}

export function summarizeMission(
  mission: Mission,
  events: readonly MemnoxEvent[],
  state: MissionState = {},
): MissionSummary {
  const own = events.filter((event) => mission.sessions.includes(event.sessionId));
  const summary = summarizeSession(own);
  // Per session, so the same command in two runs is two pieces of work and not one.
  const strains = mission.sessions.map((sessionId) =>
    strainOf(outcomesFrom(own.filter((event) => event.sessionId === sessionId))),
  );
  return {
    mission,
    sessions: mission.sessions.length,
    ...(summary === null ? {} : { firstAt: summary.started, lastAt: summary.ended }),
    actions: summary?.actions ?? 0,
    filesChanged: summary?.filesChanged ?? 0,
    outsideChanges: summary?.outsideChanges ?? 0,
    recovered: strains.reduce((total, strain) => total + strain.recovered, 0),
    failing: [...new Set(strains.flatMap((strain) => strain.failing))],
    held: summary?.held ?? 0,
    refused: own.filter((event) => event.effect === DECISION_EFFECT.DENY).length,
    approved: summary?.approved ?? 0,
    standings: mission.sessions.map((sessionId, index) => ({
      sessionId,
      standing: standingOf(sessionId, own, strains[index]?.unresolved ?? 0, state),
    })),
  };
}

/** Stopped first and waiting next, since those are the ones a person has to act on. */
function standingOf(
  sessionId: string,
  events: readonly MemnoxEvent[],
  unresolved: number,
  state: MissionState,
): SessionStanding {
  if (state.stopped?.has(sessionId) === true) return SESSION_STANDING.STOPPED;
  if (state.waiting?.has(sessionId) === true) return SESSION_STANDING.WAITING;
  if (!events.some((event) => event.sessionId === sessionId)) {
    return SESSION_STANDING.NOT_STARTED;
  }
  return unresolved > 0 ? SESSION_STANDING.FAILING : SESSION_STANDING.CLEAR;
}

/** "9 clear, 2 waiting, 1 failing", leaving out what nothing stands at. */
export function describeStandings(summary: MissionSummary): string {
  const order: readonly SessionStanding[] = [
    SESSION_STANDING.CLEAR,
    SESSION_STANDING.WAITING,
    SESSION_STANDING.FAILING,
    SESSION_STANDING.STOPPED,
    SESSION_STANDING.NOT_STARTED,
  ];
  const counted = order
    .map((standing) => ({
      standing,
      count: summary.standings.filter((each) => each.standing === standing).length,
    }))
    .filter((each) => each.count > 0)
    .map((each) => `${each.count} ${each.standing}`);
  return counted.length === 0 ? 'no sessions yet' : counted.join(', ');
}

/** The lines `memnox mission show` prints, and the voice and phone can read whole. */
export function describeMission(summary: MissionSummary): string[] {
  const { mission } = summary;
  const reference = mission.reference === undefined ? '' : ` (${mission.reference})`;
  const state = mission.closedAt === undefined ? 'open' : 'closed';
  const span =
    summary.firstAt === undefined || summary.lastAt === undefined
      ? 'no work recorded yet'
      : `worked ${describeSpan(Date.parse(summary.lastAt) - Date.parse(summary.firstAt), IN_SECONDS_THEN_MINUTES_THEN_HOURS)}`;
  return [
    `${mission.id}  ${mission.statement}${reference}, ${state}`,
    `  ${summary.sessions} session(s): ${describeStandings(summary)}`,
    `  ${span}, ${summary.actions} action(s)`,
    `  ${summary.filesChanged} file(s) changed, ${summary.outsideChanges} change(s) outside this machine`,
    `  ${summary.recovered} failure(s) recovered, ${summary.failing.length} still failing${summary.failing.length === 0 ? '' : `: ${summary.failing.join(', ')}`}`,
    `  ${summary.held} put to a person, ${summary.approved} approved, ${summary.refused} refused`,
  ];
}
