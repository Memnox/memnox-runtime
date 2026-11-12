import { basename } from 'node:path';
import {
  interruptedRuns,
  RunTerminals,
  SESSION_ACTIVITY,
  SessionHosts,
  SessionPauses,
  sessionBoard,
  type InterruptedRun,
  type BoardGroup,
  type SessionActivity,
  type SessionFacts,
} from '@memnox/core';
import { processAlive, SESSION_STATE, sessionsTool } from './sessions-tool';
import type { SessionToolDeps } from './read-tools';

/**
 * The board every surface draws, read once from what this machine knows: the sessions the
 * ledger, hooks and runs name, the pauses in force and the calls held for the person.
 */

/** A working day and the night before it, since a session left running overnight still counts. */
const BOARD_HOURS = '24';

/** The fields of a session row the board reads, as `sessionsTool` writes them. */
interface SessionToolRow {
  session: string;
  agent: string;
  task?: string;
  repositories: string[];
  lastActive: string;
  state: string;
  waitingOnYou: number;
  notAnAgent?: string;
}

const ACTIVITY_OF: Readonly<Record<string, SessionActivity>> = {
  [SESSION_STATE.WORKING]: SESSION_ACTIVITY.WORKING,
  [SESSION_STATE.OPEN]: SESSION_ACTIVITY.HANDED_BACK,
  [SESSION_STATE.IDLE]: SESSION_ACTIVITY.QUIET,
  [SESSION_STATE.QUIET]: SESSION_ACTIVITY.QUIET,
  [SESSION_STATE.PAUSED]: SESSION_ACTIVITY.QUIET,
  [SESSION_STATE.ENDED]: SESSION_ACTIVITY.ENDED,
};

export async function readSessionBoard(home: string, now: Date): Promise<BoardGroup[]> {
  // The tool answers the voice too, so it returns plain records; these are the fields it always sets.
  const rows = (await sessionsTool(boardDeps(home, now), {
    hours: BOARD_HOURS,
  })) as SessionToolRow[];
  const [pauses, cut] = await Promise.all([
    new SessionPauses(home).all(),
    readInterrupted(home),
  ]);
  const pausedBy = new Map(
    pauses
      .filter((pause) => pause.resumedAt === undefined)
      .map((pause) => [pause.sessionId, pause.signal]),
  );
  const facts = rows
    .filter((row) => row.notAnAgent === undefined)
    .map((row) => factsOf(row, pausedBy.get(row.session)))
    .map((each) =>
      cut.some((run) => run.sessionId === each.sessionId)
        ? { ...each, activity: SESSION_ACTIVITY.INTERRUPTED }
        : each,
    );
  // A run cut off before it recorded anything is still one somebody may want back.
  const unseen = cut.filter(
    (run) => !facts.some((each) => each.sessionId === run.sessionId),
  );
  return sessionBoard([...facts, ...unseen.map(interruptedFacts)]);
}

/** Runs a crash or a reboot cut off, which `memnox resume` starts again. */
export async function readInterrupted(home: string): Promise<InterruptedRun[]> {
  const [runs, hosts] = await Promise.all([
    new RunTerminals(home).all(),
    new SessionHosts(home).all(),
  ]);
  return interruptedRuns(runs, hosts, processAlive);
}

function interruptedFacts(run: InterruptedRun): SessionFacts {
  return {
    sessionId: run.sessionId,
    agent: run.agent,
    activity: SESSION_ACTIVITY.INTERRUPTED,
    lastActive: run.startedAt,
    waiting: 0,
    place: basename(run.cwd),
  };
}

function factsOf(
  row: SessionToolRow,
  paused: SessionFacts['pausedBy'] | undefined,
): SessionFacts {
  const place = row.repositories[0];
  return {
    sessionId: row.session,
    agent: row.agent,
    activity: ACTIVITY_OF[row.state] ?? SESSION_ACTIVITY.QUIET,
    lastActive: row.lastActive,
    waiting: row.waitingOnYou,
    ...(paused === undefined ? {} : { pausedBy: paused }),
    ...(place === undefined ? {} : { place: basename(place) }),
    ...(row.task === undefined ? {} : { task: row.task }),
  };
}

/** Only the home and the clock are read when listing sessions; the rest answer other tools. */
function boardDeps(home: string, now: Date): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: '',
    env: {},
    now: () => now,
    readStatus: async () => null,
    milestonesAt: async () => [],
    brief: async () => null,
  };
}
