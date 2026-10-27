import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import {
  readHermesMessages,
  readHermesSessions,
  SPEAKER,
  type ConversationLine,
  type HermesSession,
  type SessionCard,
  type SessionView,
} from '@memnox/core';
import { IDLE_WITHIN_MS, WORKING_WITHIN_MS } from '../session-tools/sessions-tool';

/**
 * Hermes sessions as cards and live views, read from Hermes's own database, so a server where
 * Hermes runs shows its work on the phone and the Mac the way a Claude Code session does.
 */

/** Marks a session as Hermes's own id rather than a ledger session, so a view is read from Hermes. */
export const HERMES_SESSION_PREFIX = 'hermes:';

const HERMES = 'hermes';

/** Lately, as the ledger's own list looks back three days. */
const LOOK_BACK_MS = 72 * 60 * 60 * 1_000;

/** What a client driving Hermes over the Agent Client Protocol records as the source, as the voice's brain does. */
const ACP_SOURCE = 'acp';

/** The list is read every couple of seconds, and a process table is not worth reading that often. */
const RUNNING_FRESH_MS = 5_000;
const PS_TIMEOUT_MS = 1_000;

const STATE = { WORKING: 'working', OPEN: 'open' } as const;

const SPOKEN: Readonly<Record<string, ConversationLine['who']>> = {
  person: SPEAKER.PERSON,
  agent: SPEAKER.AGENT,
  tool: SPEAKER.TOOL,
};

/** What the cards are read from, each stood in for by a test. */
interface HermesSeams {
  read?: typeof readHermesSessions;
  /** Whether Hermes is running here at all, since its database says nothing of a process that crashed. */
  running?: () => boolean;
  /** Sessions the voice's own brain opened in Hermes, which are never the person's work. */
  ownSessions?: ReadonlySet<string>;
}

/** Every Hermes session still open lately, as switcher cards named the way the person named Hermes. */
export function hermesCards(
  home: string,
  now: Date,
  agentName: string,
  seams: HermesSeams = {},
): SessionCard[] {
  const read = seams.read ?? readHermesSessions;
  const own = seams.ownSessions ?? new Set<string>();
  const open = read(home, new Date(now.getTime() - LOOK_BACK_MS), [ACP_SOURCE]).filter(
    (session) =>
      session.endedAt === undefined &&
      session.source !== ACP_SOURCE &&
      !own.has(session.id),
  );
  // With no Hermes process alive nothing is open, whatever the database never got to write.
  if (open.length === 0 || !(seams.running ?? hermesRunning)()) return [];
  return open
    .filter((session) => quietFor(session, now) < IDLE_WITHIN_MS)
    .map((session) => cardOf(session, now, agentName, true));
}

/** One Hermes session as the live window shows it, or null when Hermes has no such session. */
export function hermesView(
  home: string,
  sessionId: string,
  input: { now: Date; agentName: string },
): SessionView | null {
  const id = sessionId.slice(HERMES_SESSION_PREFIX.length);
  const found = readHermesSessions(home, new Date(0)).find((each) => each.id === id);
  if (found === undefined) return null;
  const card = cardOf(found, input.now, input.agentName, hermesRunning());
  const conversation = readHermesMessages(home, id).map((line) => ({
    at: line.at,
    who: SPOKEN[line.role] ?? SPEAKER.AGENT,
    text: line.text,
  }));
  return {
    sessionId,
    agent: HERMES,
    agentName: input.agentName,
    state: card.state,
    thinking: card.thinking,
    waitingOnYou: 0,
    helpers: [],
    steps: [],
    files: [],
    ...(card.task === undefined ? {} : { task: card.task }),
    ...(card.repository === undefined ? {} : { repository: card.repository }),
    ...(card.startedAt === undefined ? {} : { startedAt: card.startedAt }),
    ...(card.lastActive === undefined ? {} : { lastActive: card.lastActive }),
    ...(conversation.length === 0 ? {} : { conversation }),
  };
}

/** What Hermes said last in a session, whole enough to answer "what did it find". */
export function hermesLastAnswer(home: string, sessionId: string): string | null {
  const id = sessionId.slice(HERMES_SESSION_PREFIX.length);
  const said = readHermesMessages(home, id).filter((line) => line.role === 'agent');
  return said.at(-1)?.text ?? null;
}

export function isHermesSession(sessionId: string): boolean {
  return sessionId.startsWith(HERMES_SESSION_PREFIX);
}

function cardOf(
  session: HermesSession,
  now: Date,
  agentName: string,
  running: boolean,
): SessionCard {
  const recent = running && quietFor(session, now) < WORKING_WITHIN_MS;
  return {
    sessionId: `${HERMES_SESSION_PREFIX}${session.id}`,
    agent: HERMES,
    agentName,
    state: recent ? STATE.WORKING : STATE.OPEN,
    thinking: recent,
    runningIn: 'Hermes',
    startedAt: session.startedAt,
    lastActive: session.lastActive,
    actions: session.toolCalls,
    ...(session.title === undefined ? {} : { task: session.title }),
    ...(session.directory === undefined
      ? {}
      : { repository: basename(session.directory) }),
  };
}

function quietFor(session: HermesSession, now: Date): number {
  return now.getTime() - Date.parse(session.lastActive);
}

let runningSeen: { at: number; running: boolean } | null = null;

/** Whether a Hermes process other than an ACP server runs here, read from the process table at most every few seconds. */
function hermesRunning(clock: () => number = Date.now): boolean {
  const at = clock();
  if (runningSeen !== null && at - runningSeen.at < RUNNING_FRESH_MS)
    return runningSeen.running;
  const running = isHermesAmong(processTable());
  runningSeen = { at, running };
  return running;
}

function processTable(): string {
  try {
    return execFileSync('ps', ['-axww', '-o', 'args='], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // No process table to read is no Hermes known to be running.
    return '';
  }
}

/**
 * A command line is Hermes when its program, or the script an interpreter runs, is named `hermes`.
 * `hermes acp` is left out, since that is a client such as the voice's brain driving it, never the person.
 */
export function isHermesAmong(table: string): boolean {
  return table.split('\n').some((line) => {
    const words = line.trim().split(/\s+/);
    const at = words.slice(0, 2).findIndex((word) => basename(word) === HERMES);
    return at !== -1 && words[at + 1] !== ACP_SOURCE;
  });
}
