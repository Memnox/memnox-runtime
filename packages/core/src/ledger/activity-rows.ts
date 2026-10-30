import {
  ACTIVITY_KIND,
  ANSWERED_HOW,
  type ActivityFilter,
  type ActivityKind,
  type ActivityRow,
  type AnsweredHow,
  type DecisionStep,
  type DecisionTrace,
} from '../daemon/activity';
import { EVENT_SURFACE, EXECUTION, type MemnoxEvent } from '../event/event';

/**
 * One ledger row as the activity screen shows it, by name only: the arguments, the output and
 * a file's contents never leave the row, only their digests do, and only on a trace.
 */

/** The most rows one page carries, whatever a screen asks for. */
export const MOST_ACTIVITY_ROWS = 200;

/** Rows a page starts with when a screen names no number. */
export const ACTIVITY_PAGE_ROWS = 50;

const CURSOR_SEPARATOR = '|';

const KIND_OF_SURFACE: Readonly<Record<string, ActivityKind>> = {
  [EVENT_SURFACE.MCP]: ACTIVITY_KIND.MCP,
  [EVENT_SURFACE.SHELL]: ACTIVITY_KIND.COMMAND,
  [EVENT_SURFACE.GIT]: ACTIVITY_KIND.COMMAND,
  [EVENT_SURFACE.FILESYSTEM]: ACTIVITY_KIND.FILE,
};

/** Shell and git are commands, the filesystem is files, and the rest an agent's own tools. */
export function activityKindOf(surface: string): ActivityKind {
  return KIND_OF_SURFACE[surface] ?? ACTIVITY_KIND.TOOL;
}

/** How a let through call was answered, read from the words the ledger names its answerer in. */
export function answeredHowOf(by: string): AnsweredHow {
  if (by.includes('inside the session')) return ANSWERED_HOW.WITHIN_SESSION;
  if (/\((voice|terminal)\b|prompt\)$/.test(by)) return ANSWERED_HOW.OTHER;
  return ANSWERED_HOW.SIGNED;
}

export function activityRowOf(event: MemnoxEvent, agentName: string): ActivityRow {
  const failed =
    event.execution === EXECUTION.FAILED && event.exitCode !== undefined
      ? { failed: event.exitCode }
      : {};
  return {
    id: event.id,
    at: event.at,
    agent: event.agent,
    agentName,
    session: event.sessionId,
    kind: activityKindOf(event.surface),
    operation: event.operation,
    ...(event.target === undefined ? {} : { target: event.target }),
    effect: event.effect,
    ...(event.shadowEffect === undefined ? {} : { shadowEffect: event.shadowEffect }),
    ...(event.rule === undefined ? {} : { rule: event.rule.name }),
    reason: event.reason,
    ...(event.authorizedBy === undefined
      ? {}
      : {
          answeredBy: event.authorizedBy,
          answeredHow: answeredHowOf(event.authorizedBy),
        }),
    ...failed,
  };
}

/** The filters the ledger's own query cannot apply: the kind, and text in the names. */
export function matchesActivity(event: MemnoxEvent, filter: ActivityFilter): boolean {
  if (filter.kind !== undefined && activityKindOf(event.surface) !== filter.kind)
    return false;
  const text = filter.text?.trim().toLowerCase() ?? '';
  if (text === '') return true;
  return [event.operation, event.target ?? '', event.rule?.name ?? '', event.agent].some(
    (name) => name.toLowerCase().includes(text),
  );
}

/** Where a page ended: its last row's moment and id, which order the ledger together. */
export function cursorOf(event: Pick<MemnoxEvent, 'at' | 'id'>): string {
  return `${event.at}${CURSOR_SEPARATOR}${event.id}`;
}

/** The moment and id a cursor names, or null for one this daemon never wrote. */
export function readCursor(cursor: string): { at: string; id: string } | null {
  const split = cursor.indexOf(CURSOR_SEPARATOR);
  if (split <= 0 || split === cursor.length - 1) return null;
  return { at: cursor.slice(0, split), id: cursor.slice(split + 1) };
}

/** Whether a row comes after the cursor, newest first, as the ledger orders by moment then id. */
export function isPastCursor(
  event: Pick<MemnoxEvent, 'at' | 'id'>,
  cursor: { at: string; id: string },
): boolean {
  return event.at < cursor.at || (event.at === cursor.at && event.id < cursor.id);
}

export function decisionStepOf(event: MemnoxEvent): DecisionStep {
  return {
    at: event.at,
    operation: event.operation,
    ...(event.target === undefined ? {} : { target: event.target }),
    effect: event.effect,
  };
}

/** What `memnox trace` prints of a row: digests, never what they are digests of. */
export function decisionTraceOf(event: MemnoxEvent): DecisionTrace {
  return {
    mode: event.mode,
    ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.authorizedBy === undefined ? {} : { approvedBy: event.authorizedBy }),
    ...(event.argsDigest === undefined ? {} : { argsDigest: event.argsDigest }),
    ...(event.outputDigest === undefined ? {} : { outputDigest: event.outputDigest }),
  };
}
