import {
  DELIVERY_OPERATION,
  describeHost,
  HOUR_MS,
  LEDGER_SCAN_LIMIT,
  msToMinutes,
  PendingApprovals,
  RunTerminals,
  SessionHosts,
  SessionPauses,
  SessionSubagents,
  SessionTasks,
  SessionTurns,
  summarizeSubagents,
  type SessionTurn,
  summarizeSession,
  UNNAMED_AGENT,
  UNNAMED_SESSION,
  type MemnoxEvent,
  type PendingApproval,
  type RunTerminal,
  type SessionHost,
} from '@memnox/core';
import { readTurnOver, sessionTranscript } from '../daemon/transcript';
import { sessionSpokenToAt } from '../daemon/spoken-to';
import { withEvents } from '../event-store';
import {
  DESKTOP_APP_SPOKEN,
  desktopRoots,
  desktopSessions,
} from '../daemon/desktop-sessions';
import { repositoriesOf } from './changes-tool';
import { hostedIds } from './session-aliases';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * Every session on this machine lately, side by side, so "what is Claude doing" with two
 * Claude sessions open is answered by asking which one rather than by picking the newest.
 */

/** Said of the catch-all session, so a pause on an editor's git check is never told as an agent stuck. */
const LOCAL_WORK =
  'commands run on this Mac outside any agent session, such as an editor or a terminal checking git';

/** Said of a session holding only what the voice typed into an app, which no agent session is behind. */
const VOICE_TYPING =
  'only the voice typing into an app on this Mac for the person, with no agent session behind it';

/** Something recorded this recently is work happening now, which is what "which one is working" means. */
export const WORKING_WITHIN_MS = 3 * 60 * 1_000;
/** A turn unanswered this long is an agent that crashed or was closed, not one still thinking. */
const STALE_TURN_MS = 2 * 60 * 60 * 1_000;

/** The agent names Memnox's own voice brain records under, which answers the person and is never their work. */
const OPERATOR_AGENTS: ReadonlySet<string> = new Set([
  'memnox-operator',
  'agt_memnox-operator',
]);

const TURN = {
  /** Asked and still thinking or working through it. */
  IN_PROGRESS: 'in progress',
  /** Finished its turn and handed back, waiting on the person. */
  HANDED_BACK: 'handed back to you',
} as const;

/** Quiet this long with no live process known is a session somebody walked away from. */
export const IDLE_WITHIN_MS = 15 * 60 * 1_000;

export const SESSION_STATE = {
  /** Something recorded in the last few minutes. */
  WORKING: 'working',
  /** Its process is alive and nothing happened lately: open, waiting on the person. */
  OPEN: 'open',
  IDLE: 'idle',
  QUIET: 'quiet',
  /** Its process is gone, so it is over whatever the ledger says. */
  ENDED: 'ended',
  PAUSED: 'paused',
} as const;

type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

interface StateFacts {
  /** Its SessionEnd hook said the person closed it. */
  closed: boolean;
  paused: boolean;
  quietMs: number;
  /** Thinking through a turn, or a helper of its working, though the ledger is quiet. */
  busy: boolean;
  /** Finished its turn and handed back, which beats a burst of activity just before it. */
  handedBack: boolean;
  pid?: number;
}

/** Where a session stands right now, from the pause, how long it has been quiet, and its process. */
function stateOf(facts: StateFacts): SessionState {
  if (facts.closed) return SESSION_STATE.ENDED;
  if (facts.paused) return SESSION_STATE.PAUSED;
  const alive = facts.pid === undefined ? null : processAlive(facts.pid);
  if (alive === false) return SESSION_STATE.ENDED;
  if (facts.busy) return SESSION_STATE.WORKING;
  // It said it was done, so it is waiting on the person however recently it last acted.
  if (facts.handedBack) return SESSION_STATE.OPEN;
  if (facts.quietMs < WORKING_WITHIN_MS) return SESSION_STATE.WORKING;
  if (alive === true) return SESSION_STATE.OPEN;
  return facts.quietMs < IDLE_WITHIN_MS ? SESSION_STATE.IDLE : SESSION_STATE.QUIET;
}

/** Signal zero asks whether the process exists without touching it. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Somebody else's process is still a process.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Far enough back to cover a working day, since a session left running overnight still counts. */
const DEFAULT_HOURS = 24;

export async function sessionsTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const hours = Number(textArg(args, 'hours') ?? DEFAULT_HOURS);
  const moment = deps.now();
  const since = new Date(
    moment.getTime() - (Number.isFinite(hours) ? hours : DEFAULT_HOURS) * HOUR_MS,
  );
  const events = await withEvents(deps.home, (store) =>
    store.query({ since: since.toISOString(), limit: LEDGER_SCAN_LIMIT }),
  );
  const agent = textArg(args, 'agent');
  const grouped = bySession(
    agent === undefined ? events : events.filter((each) => each.agent === agent),
  );
  const waiting = await new PendingApprovals(deps.home).list(moment.toISOString());
  const turns = await turnsWithThinking(deps.home, grouped, agent, moment);
  await addJustOpened(deps.home, grouped, agent, since.toISOString());
  const runs = await addJustLaunched(deps.home, grouped, agent, since.toISOString());
  const hosted = await hostedIds(deps.home);
  foldAliases(grouped, hosted);
  const rows = await describeAll(deps, grouped, { turns, hosted, runs, waiting, moment });
  rows.push(...desktopRows(deps, since.toISOString(), agent));
  // Work happening now first, so "which one is working" reads off the top.
  return rows.sort(
    (a, b) =>
      Number(b.state === SESSION_STATE.WORKING) -
        Number(a.state === SESSION_STATE.WORKING) ||
      b.lastActive.localeCompare(a.lastActive),
  );
}

/** What is known of every session beside its own rows, read once for all of them. */
interface Known {
  turns: ReadonlyMap<string, SessionTurn>;
  hosted: ReadonlyMap<string, string>;
  runs: ReadonlyMap<string, RunTerminal>;
  waiting: readonly PendingApproval[];
  moment: Date;
}

/** One row per session, leaving out the voice's own brain. */
async function describeAll(
  deps: SessionToolDeps,
  grouped: ReadonlyMap<string, MemnoxEvent[]>,
  { turns, hosted, runs, waiting, moment }: Known,
): Promise<({ lastActive: string; state: SessionState } & Record<string, unknown>)[]> {
  const rows = [];
  for (const [sessionId, events] of grouped) {
    const turn = newestTurn(turns, hosted, sessionId);
    if (isOperator(events, turn)) continue;
    const run = runs.get(sessionId);
    const one = {
      sessionId,
      events,
      waiting,
      moment,
      ...(run === undefined ? {} : { run }),
    };
    rows.push(await describe(deps, turn === undefined ? one : { ...one, turn }));
  }
  return rows;
}

/** Sessions in the Codex app and Claude desktop, which no hook reports, read from what the apps keep. */
function desktopRows(
  deps: SessionToolDeps,
  since: string,
  agent: string | undefined,
): ({ lastActive: string; state: SessionState } & Record<string, unknown>)[] {
  return desktopSessions(desktopRoots(deps.home), since)
    .filter((each) => agent === undefined || each.agent === agent)
    .map((each) => {
      const quietMs = deps.now().getTime() - Date.parse(each.lastActiveAt);
      return {
        session: each.id,
        agent: each.agent,
        ...(each.title === undefined ? {} : { task: each.title }),
        repositories: each.cwd === undefined ? [] : [each.cwd],
        started: each.startedAt,
        lastActive: each.lastActiveAt,
        quietForMinutes: msToMinutes(quietMs),
        state: stateOf({
          closed: false,
          paused: false,
          quietMs,
          busy: each.working,
          handedBack: !each.working,
        }),
        turn: each.working ? TURN.IN_PROGRESS : TURN.HANDED_BACK,
        // No hook runs in the apps, so nothing of theirs is ever held for the person; the view still names the count.
        waitingOnYou: 0,
        runningIn: DESKTOP_APP_SPOKEN[each.app],
        desktop: true,
      };
    });
}

/** The agent's own conversation id and the session hosting it are one row, under the hosted id. */
function foldAliases(
  grouped: Map<string, MemnoxEvent[]>,
  hosted: ReadonlyMap<string, string>,
): void {
  for (const [alias, owner] of hosted) {
    const rows = grouped.get(alias);
    if (rows === undefined) continue;
    grouped.delete(alias);
    grouped.set(
      owner,
      [...(grouped.get(owner) ?? []), ...rows].sort((a, b) => a.at.localeCompare(b.at)),
    );
  }
}

/** The turn asked most recently under any id the session records under. */
function newestTurn(
  turns: ReadonlyMap<string, SessionTurn>,
  hosted: ReadonlyMap<string, string>,
  sessionId: string,
): SessionTurn | undefined {
  const ids = [
    sessionId,
    ...[...hosted].filter(([, id]) => id === sessionId).map(([alias]) => alias),
  ];
  return ids
    .map((id) => turns.get(id))
    .filter((each): each is SessionTurn => each !== undefined)
    .sort((a, b) => (b.promptAt ?? '').localeCompare(a.promptAt ?? ''))[0];
}

function bySession(events: readonly MemnoxEvent[]): Map<string, MemnoxEvent[]> {
  const grouped = new Map<string, MemnoxEvent[]>();
  for (const event of events) {
    const rows = grouped.get(event.sessionId) ?? [];
    rows.push(event);
    grouped.set(event.sessionId, rows);
  }
  return grouped;
}

interface OneSession {
  sessionId: string;
  events: readonly MemnoxEvent[];
  waiting: readonly PendingApproval[];
  moment: Date;
  turn?: SessionTurn;
  /** The `memnox run` that launched it, for a session whose agent has fired no hook yet. */
  run?: RunTerminal;
}

async function describe(
  deps: SessionToolDeps,
  { sessionId, events, waiting, moment, turn, run }: OneSession,
): Promise<{ lastActive: string; state: SessionState } & Record<string, unknown>> {
  // What the voice typed in is the person's word reported back, never the agent doing anything.
  const work = events.filter((each) => !isVoiceDelivery(each));
  const summary = summarizeSession(work);
  const [task, pause, host, helpers] = await Promise.all([
    new SessionTasks(deps.home).read(sessionId),
    new SessionPauses(deps.home).inForce(sessionId),
    new SessionHosts(deps.home).read(sessionId),
    new SessionSubagents(deps.home).of(sessionId),
  ]);
  const last = work[work.length - 1]?.at;
  const spokenToAt = await sessionSpokenToAt(deps.home, sessionId, turn?.promptAt);
  const activeAt = latestOf([summary?.ended, last, turn?.promptAt, turn?.endedAt]);
  // Being opened is not work, so it dates the session without making it look busy.
  const lastActive =
    activeAt === ''
      ? (host?.seenAt ?? run?.startedAt ?? events[events.length - 1]?.at ?? '')
      : activeAt;
  const voiceOnly =
    work.length === 0 &&
    events.length > 0 &&
    host === null &&
    turn === undefined &&
    run === undefined;
  const subagents = summarizeSubagents(helpers, moment);
  const thinking =
    turn !== undefined &&
    turnInProgress(turn, moment) &&
    !(await turnOverByTranscript(deps.home, sessionId, moment));
  const quietMs = activeAt === '' ? Infinity : moment.getTime() - Date.parse(activeAt);
  const busy = thinking || subagents.working.length > 0;
  const pid =
    host !== null ? { pid: host.pid } : run === undefined ? {} : { pid: run.pid };
  const repositories = repositoriesOf(events);
  return {
    session: sessionId,
    agent:
      namedAgent(work) ??
      summary?.agent ??
      turn?.agent ??
      run?.agent ??
      namedAgent(events) ??
      'unknown',
    ...(task === null ? {} : { task: task.statement }),
    // The mission stays the task; what the person asked last sits beside it.
    ...(task?.latestAsk === undefined ? {} : { lastAsk: task.latestAsk }),
    repositories: repositories.length > 0 || run === undefined ? repositories : [run.cwd],
    started:
      summary?.started ??
      work[0]?.at ??
      turn?.promptAt ??
      run?.startedAt ??
      events[0]?.at ??
      '',
    lastActive,
    // The hook's word for when they last prompted, for an agent whose transcript Memnox cannot read.
    ...(turn?.promptAt === undefined ? {} : { promptedAt: turn.promptAt }),
    ...(spokenToAt === undefined ? {} : { spokenToAt }),
    quietForMinutes: msToMinutes(moment.getTime() - Date.parse(lastActive)),
    state: stateOf({
      closed: host?.endedAt !== undefined,
      paused: pause !== null,
      quietMs,
      busy,
      handedBack: turn !== undefined && !thinking && turn.endedAt !== undefined,
      ...pid,
    }),
    ...(turn === undefined
      ? {}
      : { turn: thinking ? TURN.IN_PROGRESS : TURN.HANDED_BACK }),
    ...countsOf(summary, work.length),
    waitingOnYou: waiting.filter((each) => each.request.sessionId === sessionId).length,
    ...(pause === null ? {} : { paused: pause.reason }),
    ...runningIn(host),
    // Before its first hook only the run knows the app its tab is in.
    ...(host === null && run?.app !== undefined ? { runningIn: run.app } : {}),
    ...(helpers.length === 0 ? {} : { subagents }),
    ...(sessionId === UNNAMED_SESSION ? { notAnAgent: LOCAL_WORK } : {}),
    ...(voiceOnly ? { notAnAgent: VOICE_TYPING } : {}),
  };
}

/**
 * Each session's turn, and a row for any session thinking since its prompt, which has recorded
 * nothing yet and is still the one working.
 */
async function turnsWithThinking(
  home: string,
  grouped: Map<string, MemnoxEvent[]>,
  agent: string | undefined,
  moment: Date,
): Promise<Map<string, SessionTurn>> {
  const turns = new Map(
    (await new SessionTurns(home).all())
      .filter((each) => agent === undefined || each.agent === agent)
      .map((each) => [each.sessionId, each]),
  );
  for (const [sessionId, turn] of turns) {
    if (!grouped.has(sessionId) && turnInProgress(turn, moment))
      grouped.set(sessionId, []);
  }
  return turns;
}

/** A session opened and not yet asked anything, alive but with nothing in the ledger. */
async function addJustOpened(
  home: string,
  grouped: Map<string, MemnoxEvent[]>,
  agent: string | undefined,
  since: string,
): Promise<void> {
  for (const host of await new SessionHosts(home).all()) {
    if (grouped.has(host.sessionId) || host.seenAt < since) continue;
    if (agent !== undefined && host.agent !== agent) continue;
    if (processAlive(host.pid)) grouped.set(host.sessionId, []);
  }
}

/**
 * A session `memnox run` launched whose agent has fired no hook yet: its run is noted before the
 * agent starts and lives as long as it, so a session started a moment ago is counted at once.
 */
async function addJustLaunched(
  home: string,
  grouped: Map<string, MemnoxEvent[]>,
  agent: string | undefined,
  since: string,
): Promise<Map<string, RunTerminal>> {
  const runs = new Map<string, RunTerminal>();
  for (const run of await new RunTerminals(home).all()) {
    if (run.startedAt < since || !processAlive(run.pid)) continue;
    if (agent !== undefined && run.agent !== agent) continue;
    runs.set(run.sessionId, run);
    if (!grouped.has(run.sessionId)) grouped.set(run.sessionId, []);
  }
  return runs;
}

/**
 * The agent a session's rows name. A child the agent runs, like git, can record as "an agent",
 * and a session named by its first row would then be called that for good.
 */
function namedAgent(events: readonly MemnoxEvent[]): string | undefined {
  return events.find((each) => each.agent !== UNNAMED_AGENT && each.agent !== '')?.agent;
}

function isVoiceDelivery(event: MemnoxEvent): boolean {
  return event.operation === DELIVERY_OPERATION;
}

/** How much it did, from the ledger's own summary of the session. */
function countsOf(
  summary: ReturnType<typeof summarizeSession>,
  rows: number,
): { actions: number; filesChanged: number; refused: number } {
  return {
    actions: summary?.actions ?? rows,
    filesChanged: summary?.filesChanged ?? 0,
    refused: summary?.blockedCount ?? 0,
  };
}

/** The newest of the moments known, so a turn still being thought through counts as activity. */
function latestOf(moments: readonly (string | undefined)[]): string {
  return (
    moments
      .filter((each): each is string => each !== undefined)
      .sort()
      .pop() ?? ''
  );
}

/** The voice's own brain, which runs as an agent too and is never one of the person's sessions. */
export function isOperatorAgent(agent: string): boolean {
  return OPERATOR_AGENTS.has(agent);
}

/** The brain's own session, by any row or turn it recorded, so a question to the voice is never counted as an agent. */
function isOperator(
  events: readonly MemnoxEvent[],
  turn: SessionTurn | undefined,
): boolean {
  if (turn !== undefined && OPERATOR_AGENTS.has(turn.agent)) return true;
  return events.some((each) => OPERATOR_AGENTS.has(each.agent));
}

/**
 * A turn the agent's own transcript shows ended though its hook never said so: a turn the person
 * stopped, or one an API error ended, fires no Stop hook and would read as thinking for hours.
 */
export async function turnOverByTranscript(
  home: string,
  sessionId: string,
  moment: Date,
): Promise<boolean> {
  const path = await sessionTranscript(home, sessionId).catch(() => null);
  return path !== null && readTurnOver(path, moment);
}

/** Asked and not yet answered, and asked recently enough that a crash is not mistaken for thinking. */
function turnInProgress(turn: SessionTurn, moment: Date): boolean {
  if (turn.promptAt === undefined) return false;
  if (turn.endedAt !== undefined && turn.endedAt >= turn.promptAt) return false;
  return moment.getTime() - Date.parse(turn.promptAt) < STALE_TURN_MS;
}

/**
 * The app it runs in, short enough for a button, and where in it, in words the brain can match
 * "the one in VS Code" against: a Terminal tab, an editor's terminal, or an agent's panel.
 */
function runningIn(host: SessionHost | null): { runningIn?: string; where?: string } {
  const where = host === null ? undefined : describeHost(host);
  return {
    ...(host?.app === undefined ? {} : { runningIn: host.app }),
    ...(where === undefined ? {} : { where }),
  };
}
