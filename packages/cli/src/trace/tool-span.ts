import { SPAN_KIND, SPAN_STATUS, type SpanValue } from '@memnox/core';
import { recordSpan } from './voice-trace';

/** One operator tool call, hung on the trace of the question it answers. */
interface ToolCall {
  name: string;
  startAt: string;
  endAt: string;
  /** What it answered, read only for yes or no flags. */
  answer?: unknown;
  error?: string;
}

/** Tracing never stands in the way of the answer, so a span that cannot be written is let go. */
export async function traceToolCall(home: string, call: ToolCall): Promise<void> {
  await recordSpan(home, {
    name: `operator.${call.name}`,
    kind: SPAN_KIND.TOOL,
    startAt: call.startAt,
    endAt: call.endAt,
    status: call.error === undefined ? SPAN_STATUS.OK : SPAN_STATUS.ERROR,
    attributes: outcomeOf(call.answer),
    ...(call.error === undefined ? {} : { error: call.error }),
    under: 'brain',
  }).catch(() => undefined);
}

/** The yes or no a tool answered with, which is what a trace needs; never the data it read. */
const OUTCOME_FLAGS: readonly string[] = [
  'shown',
  'sent',
  'proposed',
  'started',
  'watching',
  'ran',
  'paused',
  'found',
];

function outcomeOf(answer: unknown): Record<string, SpanValue> {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return {};
  const fields = answer as Record<string, unknown>; // narrowed to an object just above
  const flags: Record<string, SpanValue> = {};
  for (const flag of OUTCOME_FLAGS) {
    const value = fields[flag];
    if (typeof value === 'boolean') flags[flag] = value;
    else if (typeof value === 'string') flags[flag] = true;
  }
  return flags;
}
