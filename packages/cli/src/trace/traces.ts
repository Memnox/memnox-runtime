import {
  LEDGER_SESSION_LIMIT,
  sessionTrace,
  SessionTurns,
  summarizeTrace,
  TraceStore,
  type Span,
  type TraceSummary,
} from '@memnox/core';
import { withEvents } from '../event-store';

/**
 * Finding a trace by what a person calls it: the last thing they asked the voice, a session by
 * its id, or a trace by its own id. Memnox's own traces are read from the store; an agent's
 * session is built from its ledger rows, so every session ever recorded has one.
 */

export const LAST_TRACE = 'last';

/** Memnox's own traces lately, newest first, each summed up. */
export async function recentTraces(home: string, most: number): Promise<TraceSummary[]> {
  const byTrace = new Map<string, Span[]>();
  for (const span of await new TraceStore(home).recent()) {
    byTrace.set(span.traceId, [...(byTrace.get(span.traceId) ?? []), span]);
  }
  return [...byTrace.values()]
    .map((spans) => summarizeTrace(spans))
    .filter((summary): summary is TraceSummary => summary !== null)
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .slice(0, most);
}

/** The spans of one trace, or of a session's trace, or nothing when neither is known. */
export async function traceNamed(home: string, id: string): Promise<Span[]> {
  if (id === LAST_TRACE) {
    const [last] = await recentTraces(home, 1);
    return last === undefined ? [] : new TraceStore(home).trace(last.traceId);
  }
  const stored = await new TraceStore(home).trace(id);
  if (stored.length > 0) return stored;
  return sessionSpans(home, id.replace(/^ses:/, ''));
}

async function sessionSpans(home: string, sessionId: string): Promise<Span[]> {
  const [events, turn] = await Promise.all([
    withEvents(home, (store) => store.query({ sessionId, limit: LEDGER_SESSION_LIMIT })),
    new SessionTurns(home).read(sessionId),
  ]);
  return sessionTrace(sessionId, events, turn);
}
