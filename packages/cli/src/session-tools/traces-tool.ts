import {
  DISPLAY,
  DisplayRequests,
  summarizeTrace,
  TRACE_ROWS,
  waterfall,
  type Span,
} from '@memnox/core';
import { LAST_TRACE, traceNamed } from '../trace/traces';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * "Why was that slow?" or "show me the trace of that session": a trace summed up for the voice
 * and drawn on screen as a waterfall, from Memnox's own traces or from a session's ledger rows.
 */

const SAY =
  'A waterfall of it is on their screen. Say in a sentence or two how long it took and what took longest, in seconds, and anything that failed or was refused. Name steps the way a person would: the brain thinking, reading the sessions, hearing them, speaking.';

export async function tracesTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const id = textArg(args, 'session') ?? textArg(args, 'trace') ?? LAST_TRACE;
  const spans = await traceNamed(deps.home, id);
  const summary = summarizeTrace(spans);
  if (summary === null) {
    return {
      found: false,
      said: 'Nothing is traced under that yet. A session needs to have done something, or the voice needs to have been asked something.',
    };
  }
  if (textArg(args, 'show') !== 'false')
    await drawTrace(deps, id, spans, summary.totalMs);
  const rows = waterfall(spans).slice(0, TRACE_ROWS);
  return {
    found: true,
    summary,
    steps: rows.map((row) => ({
      name: row.span.name,
      ms: row.durationMs,
      status: row.span.status,
      depth: row.depth,
    })),
    said: SAY,
  };
}

async function drawTrace(
  deps: SessionToolDeps,
  id: string,
  spans: readonly Span[],
  totalMs: number,
): Promise<void> {
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.TRACE,
    sessionId: id,
    agent: 'memnox',
    title: id === LAST_TRACE ? 'Your last question' : 'Session trace',
    trace: {
      totalMs,
      rows: waterfall(spans).map((row) => ({
        name: row.span.name,
        depth: row.depth,
        offsetMs: row.offsetMs,
        durationMs: row.durationMs,
        status: row.span.status,
      })),
    },
    at: deps.now().toISOString(),
  });
}
