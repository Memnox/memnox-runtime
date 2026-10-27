import { DECISION_EFFECT } from '../constants/decision.constants';
import type { MemnoxEvent } from '../event/event';
import type { SessionTurn } from '../session/session-turns';
import { SPAN_KIND, SPAN_STATUS, type Span, type SpanStatus } from './span';

/**
 * An agent session as a trace, built from what Memnox already records: the session, each turn
 * the person gave it, and every action inside with the decision on it, how long it ran and how it
 * ended. Nothing new is written to get it, so every session ever recorded can be looked at this way.
 */

/** Long enough to read a path at a glance, never a whole command line. */
const MOST_TARGET_CHARS = 120;

export function sessionTraceId(sessionId: string): string {
  return `ses:${sessionId}`;
}

export function sessionTrace(
  sessionId: string,
  events: readonly MemnoxEvent[],
  turn: SessionTurn | null,
): Span[] {
  const own = [...events]
    .filter((each) => each.sessionId === sessionId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const windows = (turn?.windows ?? []).filter((each) => each.promptAt !== '');
  const moments = [
    ...own.map((each) => each.at),
    ...own.map(endOf),
    ...windows.flatMap((each) => [each.promptAt, each.endedAt ?? each.promptAt]),
  ];
  if (moments.length === 0) return [];
  const traceId = sessionTraceId(sessionId);
  const root = rootSpan(traceId, { sessionId, own, agent: turn?.agent, moments });
  const turns: Span[] = windows.map((window, index) => ({
    traceId,
    spanId: `turn-${index + 1}`,
    parentId: root.spanId,
    name: `turn ${index + 1}`,
    kind: SPAN_KIND.AGENT,
    startAt: window.promptAt,
    endAt: window.endedAt ?? latest([window.promptAt, ...own.map(endOf)]),
    status: SPAN_STATUS.OK,
    attributes: { finished: window.endedAt !== undefined },
  }));
  const actions = own.map((event, index) =>
    actionSpan(traceId, event, index, parentOf(event, turns, root)),
  );
  return [root, ...turns, ...actions];
}

/** The whole session, failed when any action in it did. */
function rootSpan(
  traceId: string,
  session: {
    sessionId: string;
    own: readonly MemnoxEvent[];
    agent: string | undefined;
    moments: readonly string[];
  },
): Span {
  const { sessionId, own, agent, moments } = session;
  return {
    traceId,
    spanId: 'session',
    name: `session ${own[0]?.agent ?? agent ?? 'agent'}`,
    kind: SPAN_KIND.AGENT,
    startAt: earliest(moments),
    endAt: latest(moments),
    status: own.some((each) => statusOf(each) === SPAN_STATUS.ERROR)
      ? SPAN_STATUS.ERROR
      : SPAN_STATUS.OK,
    attributes: { sessionId, actions: own.length },
  };
}

function actionSpan(
  traceId: string,
  event: MemnoxEvent,
  index: number,
  parentId: string,
): Span {
  const status = statusOf(event);
  return {
    traceId,
    spanId: `action-${index + 1}`,
    parentId,
    name: event.operation,
    kind: event.surface === 'mcp' ? SPAN_KIND.TOOL : SPAN_KIND.ACTION,
    startAt: event.at,
    endAt: endOf(event),
    status,
    attributes: {
      surface: event.surface,
      effect: event.effect,
      ...(event.target === undefined
        ? {}
        : { target: event.target.slice(0, MOST_TARGET_CHARS) }),
      ...(event.rule === undefined ? {} : { rule: event.rule.name }),
      ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    },
    ...(status === SPAN_STATUS.OK ? {} : { error: event.reason }),
  };
}

/** The turn the action fell inside, else the session itself. */
function parentOf(event: MemnoxEvent, turns: readonly Span[], root: Span): string {
  const inside = turns.filter(
    (each) => each.startAt <= event.at && event.at <= each.endAt,
  );
  return inside[inside.length - 1]?.spanId ?? root.spanId;
}

function statusOf(event: MemnoxEvent): SpanStatus {
  if (event.effect === DECISION_EFFECT.DENY) return SPAN_STATUS.REFUSED;
  if (event.exitCode !== undefined && event.exitCode !== 0) return SPAN_STATUS.ERROR;
  return SPAN_STATUS.OK;
}

function endOf(event: MemnoxEvent): string {
  return new Date(Date.parse(event.at) + (event.durationMs ?? 0)).toISOString();
}

function earliest(moments: readonly string[]): string {
  return [...moments].sort()[0] ?? '';
}

function latest(moments: readonly string[]): string {
  return [...moments].sort().pop() ?? '';
}
