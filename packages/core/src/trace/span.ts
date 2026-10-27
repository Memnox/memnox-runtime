/**
 * One timed step of work, the way Logfire and OpenTelemetry describe it: what ran, inside what,
 * from when to when, and whether it went well. Memnox traces two things with it: what an agent
 * did in a session, and what Memnox itself did to answer a person.
 */

export const SPAN_KIND = {
  /** A person's question to the voice, from their last word to its last word. */
  VOICE: 'voice',
  /** The brain thinking, from the question to its last chunk. */
  BRAIN: 'brain',
  /** A tool the brain or an agent called. */
  TOOL: 'tool',
  /** Listening, endpointing and speaking on the Mac. */
  MAC: 'mac',
  /** A whole agent session, or one of its turns. */
  AGENT: 'agent',
  /** One action an agent took, with the decision on it. */
  ACTION: 'action',
  /** A memnox command run on the person's behalf. */
  COMMAND: 'command',
} as const;

export type SpanKind = (typeof SPAN_KIND)[keyof typeof SPAN_KIND];

export const SPAN_STATUS = {
  OK: 'ok',
  ERROR: 'error',
  /** A rule or a person stopped it, which is not a fault. */
  REFUSED: 'refused',
} as const;

export type SpanStatus = (typeof SPAN_STATUS)[keyof typeof SPAN_STATUS];

export type SpanValue = string | number | boolean;

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  startAt: string;
  endAt: string;
  status: SpanStatus;
  attributes: Record<string, SpanValue>;
  /** What went wrong, in a sentence, when it did. */
  error?: string;
}

/** One line of a waterfall: the span, how deep it sits, and where it falls on the trace's clock. */
export interface WaterfallRow {
  span: Span;
  depth: number;
  offsetMs: number;
  durationMs: number;
}

export function durationOf(span: Span): number {
  return Math.max(0, Date.parse(span.endAt) - Date.parse(span.startAt));
}

/** The spans in tree order, each under its parent and siblings by start, timed from the first. */
export function waterfall(spans: readonly Span[]): WaterfallRow[] {
  if (spans.length === 0) return [];
  const start = Math.min(...spans.map((span) => Date.parse(span.startAt)));
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const span of spans) {
    // A parent that was never written down, or is in another trace, makes this a root here.
    if (span.parentId === undefined || !ids.has(span.parentId)) roots.push(span);
    else children.set(span.parentId, [...(children.get(span.parentId) ?? []), span]);
  }
  const rows: WaterfallRow[] = [];
  const visit = (span: Span, depth: number): void => {
    rows.push({
      span,
      depth,
      offsetMs: Date.parse(span.startAt) - start,
      durationMs: durationOf(span),
    });
    for (const child of byStart(children.get(span.spanId) ?? [])) visit(child, depth + 1);
  };
  for (const root of byStart(roots)) visit(root, 0);
  return rows;
}

function byStart(spans: readonly Span[]): Span[] {
  return [...spans].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** What a person wants first about a trace: how long, what took longest, and what failed. */
export interface TraceSummary {
  traceId: string;
  name: string;
  startAt: string;
  totalMs: number;
  spans: number;
  errors: number;
  refused: number;
  /** The longest step below the top, which is usually the answer to "why was that slow". */
  slowest?: { name: string; durationMs: number };
}

export function summarizeTrace(spans: readonly Span[]): TraceSummary | null {
  const rows = waterfall(spans);
  const root = rows[0];
  if (root === undefined) return null;
  const end = Math.max(...spans.map((span) => Date.parse(span.endAt)));
  const below = rows
    .filter((row) => row.depth > 0)
    .sort((a, b) => b.durationMs - a.durationMs)[0];
  return {
    traceId: root.span.traceId,
    name: root.span.name,
    startAt: root.span.startAt,
    totalMs: end - Date.parse(root.span.startAt),
    spans: spans.length,
    errors: spans.filter((span) => span.status === SPAN_STATUS.ERROR).length,
    refused: spans.filter((span) => span.status === SPAN_STATUS.REFUSED).length,
    ...(below === undefined
      ? {}
      : { slowest: { name: below.span.name, durationMs: below.durationMs } }),
  };
}
