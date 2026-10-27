import { basename } from 'node:path';
import {
  ACTION,
  DECISION_EFFECT,
  describeHost,
  LEDGER_SESSION_LIMIT,
  SessionHosts,
  SessionTasks,
  SPEAKER,
  type ConversationLine,
  type MemnoxEvent,
  type SessionHost,
  type SessionTask,
} from '@memnox/core';
import {
  codexConversation,
  desktopConversation,
  desktopRoots,
  desktopSessionById,
} from '../daemon/desktop-sessions';
import { readWholeConversation, sessionTranscript } from '../daemon/transcript';
import { withEvents } from '../event-store';
import { noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { scopeOf } from './session-scope';
import { touchesOf } from './session-writes';
import { repositoriesOf } from './changes-tool';
import { processAlive } from './sessions-tool';

/**
 * A whole session, start to end: when it began, how it ended, and every turn in it, what the
 * person asked, what the agent answered and what it did meanwhile, from its own transcript and the ledger.
 */

/** One request and everything it led to. */
interface HistoryTurn {
  at: string;
  asked: string;
  answered?: string;
  /** Tools it ran, as its transcript shows them. */
  tools: number;
  wrote: string[];
  moreWritten?: number;
  committed: number;
  pushed: string[];
  /** What the agent said while it worked, which carries why it changed what it did and what it settled on. */
  explained: string[];
  /** What it said before these, counted rather than dropped unsaid. */
  moreExplained?: number;
  /** What a rule or the person refused, by what it was. */
  refused: string[];
  /** What was put to the person, whatever they answered. */
  askedYou: number;
  /** Commands that ran and failed. */
  failed: number;
}

/** Enough turns for a day's session; earlier ones are counted rather than dropped unsaid. */
const MOST_TURNS = 30;
const MOST_ASK_CHARS = 300;
const MOST_ANSWER_CHARS = 500;
const MOST_FILES_NAMED = 5;
const MOST_REFUSALS_NAMED = 3;
/** The latest of what it said along the way, enough to tell why without reading a day of it aloud. */
const MOST_EXPLAINED = 8;
const MOST_EXPLAINED_CHARS = 280;

/** What was asked before any transcript line, when the agent keeps no transcript Memnox can read. */
const UNRECORDED = 'what it was asked is not in a transcript Memnox can read';

/** Sorts after every timestamp, so the last turn runs to the end of the record. */
const AFTER_EVERY_MOMENT = String.fromCharCode(0xffff);

/** Each turn of the session, oldest first, with the ledger's rows set in the turn they happened in. */
export function turnsOf(
  lines: readonly ConversationLine[],
  rows: readonly MemnoxEvent[],
  firstAsked?: string,
): HistoryTurn[] {
  const asks = lines.filter((line) => line.who === SPEAKER.PERSON);
  const starts =
    asks.length > 0
      ? asks
      : [{ at: rows[0]?.at ?? '', who: SPEAKER.PERSON, text: firstAsked ?? UNRECORDED }];
  return starts.map((ask, index) => {
    const from = index === 0 ? '' : ask.at;
    const to = starts[index + 1]?.at ?? AFTER_EVERY_MOMENT;
    const said = lines.filter((line) => line.at >= ask.at && line.at < to);
    const done = rows.filter((row) => row.at >= from && row.at < to);
    return {
      at: ask.at,
      asked: clipped(ask.text, MOST_ASK_CHARS),
      ...toldIn(said),
      ...didIn(done),
    };
  });
}

/** What the agent said in one turn: its answer, and what it explained on the way there. */
function toldIn(
  said: readonly ConversationLine[],
): Pick<HistoryTurn, 'answered' | 'tools' | 'explained' | 'moreExplained'> {
  const answer = [...said].reverse().find((line) => line.who === SPEAKER.AGENT);
  // Everything it said before its answer is it explaining itself as it went.
  const along = said.filter((line) => line.who === SPEAKER.AGENT && line !== answer);
  const explained = along
    .slice(-MOST_EXPLAINED)
    .map((line) => clipped(line.text, MOST_EXPLAINED_CHARS));
  return {
    ...(answer === undefined
      ? {}
      : { answered: clipped(answer.text, MOST_ANSWER_CHARS) }),
    tools: said.filter((line) => line.who === SPEAKER.TOOL).length,
    explained,
    ...(along.length > explained.length
      ? { moreExplained: along.length - explained.length }
      : {}),
  };
}

/** What the ledger saw it do in one turn. */
function didIn(
  done: readonly MemnoxEvent[],
): Omit<
  HistoryTurn,
  'at' | 'asked' | 'answered' | 'tools' | 'explained' | 'moreExplained'
> {
  return {
    ...wroteIn(done),
    committed: done.filter((row) => went(row, ACTION.GIT_COMMIT)).length,
    pushed: done
      .filter((row) => went(row, ACTION.GIT_PUSH))
      .map((row) => row.target ?? 'its branch'),
    refused: done
      .filter((row) => row.effect === DECISION_EFFECT.DENY)
      .slice(0, MOST_REFUSALS_NAMED)
      .map((row) =>
        [row.operation, row.target].filter((part) => part !== undefined).join(' '),
      ),
    askedYou: done.filter((row) => row.effect === DECISION_EFFECT.ASK).length,
    failed: done.filter((row) => row.exitCode !== undefined && row.exitCode !== 0).length,
  };
}

function wroteIn(
  rows: readonly MemnoxEvent[],
): Pick<HistoryTurn, 'wrote' | 'moreWritten'> {
  const files = [
    ...new Set(
      touchesOf(rows)
        .filter((touch) => !touch.folder)
        .map((touch) => basename(touch.path)),
    ),
  ];
  return {
    wrote: files.slice(0, MOST_FILES_NAMED),
    ...(files.length > MOST_FILES_NAMED
      ? { moreWritten: files.length - MOST_FILES_NAMED }
      : {}),
  };
}

function went(row: MemnoxEvent, operation: string): boolean {
  return (
    row.operation === operation &&
    row.effect === DECISION_EFFECT.ALLOW &&
    (row.exitCode === undefined || row.exitCode === 0)
  );
}

function clipped(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`;
}

export async function historyTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null) return { ...scope, found: false };
  const record = await recordOf(deps.home, scope.sessionId);
  const turns = turnsOf(
    record.lines,
    record.rows,
    record.task?.statement ?? record.title,
  );
  if (turns.length === 0 && record.rows.length === 0) return { ...scope, found: false };
  await noteFocus(deps, scope, 'asked about');
  return { ...scope, found: true, ...accountOf(record, turns) };
}

/** Everything kept about one session: its ledger rows oldest first, where it ran, its task and its transcript. */
interface SessionRecord {
  rows: MemnoxEvent[];
  host: SessionHost | null;
  task: SessionTask | null;
  lines: ConversationLine[];
  /** A desktop session's own title, which stands where a task would. */
  title?: string;
}

async function recordOf(home: string, sessionId: string): Promise<SessionRecord> {
  const desktop = desktopSessionById(desktopRoots(home), sessionId);
  if (desktop !== null) {
    return {
      rows: [],
      host: null,
      task: null,
      lines: desktopConversation(desktop),
      ...(desktop.title === undefined ? {} : { title: desktop.title }),
    };
  }
  const [rows, host, task, path] = await Promise.all([
    withEvents(home, (store) => store.query({ sessionId, limit: LEDGER_SESSION_LIMIT })),
    new SessionHosts(home).read(sessionId),
    new SessionTasks(home).read(sessionId),
    sessionTranscript(home, sessionId),
  ]);
  return {
    rows: [...rows].sort((a, b) => a.at.localeCompare(b.at)),
    host,
    task,
    // Codex in a terminal keeps its own log under the same id, which says what it answered.
    lines:
      path === null
        ? codexConversation(desktopRoots(home).codex, host?.agentSession ?? sessionId)
        : readWholeConversation(path),
  };
}

/** The session told from its start to how it ended, the latest turns whole and the earlier ones counted. */
function accountOf(
  record: SessionRecord,
  turns: readonly HistoryTurn[],
): Record<string, unknown> {
  const { rows, host, task, lines } = record;
  const { startedAt, lastAt } = spanOf(host?.seenAt, rows, lines);
  const kept = turns.slice(-MOST_TURNS);
  const ranIn = host === null ? undefined : describeHost(host);
  return {
    ...(task === null ? {} : { task: task.statement }),
    repositories: repositoriesOf(rows).map((each) => basename(each)),
    ...(ranIn === undefined ? {} : { ranIn }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...endingOf(host, lastAt),
    turnCount: turns.length,
    ...(turns.length > kept.length ? { earlierTurns: turns.length - kept.length } : {}),
    turns: kept,
    totals: totalsOf(turns, rows.length),
    said: WHOLE,
  };
}

/** The first moment anything says the session was there, and the last it did or said anything. */
function spanOf(
  seenAt: string | undefined,
  rows: readonly MemnoxEvent[],
  lines: readonly ConversationLine[],
): { startedAt?: string; lastAt?: string } {
  const moments = [
    seenAt,
    rows[0]?.at,
    lines[0]?.at,
    rows[rows.length - 1]?.at,
    lines[lines.length - 1]?.at,
  ]
    .filter((at): at is string => at !== undefined && at !== '')
    .sort();
  const startedAt = moments[0];
  const lastAt = moments[moments.length - 1];
  return {
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(lastAt === undefined ? {} : { lastAt }),
  };
}

/** How the brain is told a session ended, in words it can say back. */
const ENDING = {
  CLOSED: 'closed',
  GONE: 'its process is gone',
  OPEN: 'no, it is still open',
} as const;

/** How it ended, from the hook that closed it or its process being gone, or that it is still open. */
function endingOf(
  host: { endedAt?: string; pid: number } | null,
  lastAt: string | undefined,
): Record<string, string> {
  if (host?.endedAt !== undefined) return { ended: ENDING.CLOSED, endedAt: host.endedAt };
  if (host !== null && !processAlive(host.pid))
    return {
      ended: ENDING.GONE,
      ...(lastAt === undefined ? {} : { lastActiveAt: lastAt }),
    };
  if (host === null) return lastAt === undefined ? {} : { lastActiveAt: lastAt };
  return {
    ended: ENDING.OPEN,
    ...(lastAt === undefined ? {} : { lastActiveAt: lastAt }),
  };
}

function totalsOf(
  turns: readonly HistoryTurn[],
  actions: number,
): Record<string, number> {
  function sum(pick: (turn: HistoryTurn) => number): number {
    return turns.reduce((total, turn) => total + pick(turn), 0);
  }
  return {
    actions,
    filesWritten: sum((turn) => turn.wrote.length + (turn.moreWritten ?? 0)),
    commits: sum((turn) => turn.committed),
    pushes: sum((turn) => turn.pushed.length),
    refused: sum((turn) => turn.refused.length),
    askedYou: sum((turn) => turn.askedYou),
    failedCommands: sum((turn) => turn.failed),
  };
}

const WHOLE =
  'This is the whole session, oldest turn first: when it started, whether and how it ended, and each turn with what they asked, what it answered, what it said along the way and what it did. Answer what they asked from it, in a few sentences, starting with what matters most to their question; never read the list out. Asked what happened, tell it as a story of purpose: what they wanted, what the agent changed and why, taking the why from what it said along the way, and what was decided, like a choice it made, something it ruled out or a direction they agreed on, and where it stands now. Name a decision only where its own words say one was made, never one you inferred. When it ended because its process is gone, say so plainly. Use turn numbers only if they ask for the order of things.';
