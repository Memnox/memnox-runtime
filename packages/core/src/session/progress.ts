import { DECISION_EFFECT } from '../constants/decision.constants';
import type { ProgressAlmost, ProgressLadder, ProgressWeek } from '../daemon/policies';
import { EVENT_SURFACE, type MemnoxEvent } from '../event/event';
import { ALLOWANCE_SIGNAL_PREFIX } from '../gate/local-gate';
import {
  ASSIST_ASK_RATE,
  AUTONOMY,
  AUTONOMY_ORDER,
  describeLevel,
  MINIMUM_EVIDENCE,
  PROMOTION_THRESHOLD,
  SUPERVISED_ASK_RATE,
  type AutonomyLevel,
  type Delegation,
} from './autonomy';
import { AUTOPILOT_OPERATION } from './earned';

/**
 * How far the agents have been let go, in counts a person can check: what is nearly a habit, the
 * next rung and what it asks of the record, and a week of asking against a week of not asking.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

/** The id every autopilot grant starts with, so its allows are told apart from a person's. */
const EARNED_ID_PREFIX = 'ern_';

/** Approved, never refused, and short of the threshold that makes it ready. */
export function almostReady(
  found: readonly Delegation[],
  threshold = PROMOTION_THRESHOLD,
): ProgressAlmost[] {
  return found
    .filter(
      (each) => each.denials === 0 && each.approvals > 0 && each.approvals < threshold,
    )
    .map((each) => ({
      action: each.action,
      approvals: each.approvals,
      needed: threshold - each.approvals,
    }));
}

/** The rung the machine stands on, the one above it, and what the record must show to reach it. */
export function ladderOf(
  level: AutonomyLevel,
  week: { actions: number; asks: number },
): ProgressLadder {
  const next = AUTONOMY_ORDER[AUTONOMY_ORDER.indexOf(level) + 1];
  return {
    level,
    says: describeLevel(level),
    rungs: [...AUTONOMY_ORDER],
    ...(next === undefined ? {} : { next, needs: needsFor(next) }),
    actionsThisWeek: week.actions,
    asksThisWeek: week.asks,
    minimumEvidence: MINIMUM_EVIDENCE,
  };
}

function needsFor(next: AutonomyLevel): string {
  const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
  const needs: Record<AutonomyLevel, string> = {
    [AUTONOMY.OBSERVE]: '',
    [AUTONOMY.ASSIST]: 'enforce mode, with at least one rule in force',
    [AUTONOMY.SUPERVISED]: `a week where under ${percent(ASSIST_ASK_RATE)} of actions ask`,
    [AUTONOMY.AUTONOMOUS]: `a week of at least ${MINIMUM_EVIDENCE} actions where under ${percent(SUPERVISED_ASK_RATE)} ask`,
    [AUTONOMY.TRUSTED]: `a week of at least ${MINIMUM_EVIDENCE} actions where nothing asks`,
  };
  return needs[next];
}

/** The week ending now and the one before it, each in counts. */
export function weeksOfProgress(
  events: readonly MemnoxEvent[],
  now: Date,
): { thisWeek: ProgressWeek; lastWeek: ProgressWeek } {
  const end = now.getTime();
  return {
    thisWeek: weekOf(events, end - WEEK_MS, end),
    lastWeek: weekOf(events, end - 2 * WEEK_MS, end - WEEK_MS),
  };
}

function weekOf(events: readonly MemnoxEvent[], from: number, to: number): ProgressWeek {
  const inWeek = events.filter((event) => {
    const at = Date.parse(event.at);
    return at >= from && at < to;
  });
  const work = inWeek.filter((event) => event.surface !== EVENT_SURFACE.CONFIG);
  return {
    from: new Date(from).toISOString(),
    asked: work.filter(
      (event) => (event.shadowEffect ?? event.effect) === DECISION_EFFECT.ASK,
    ).length,
    answeredByAutopilot: work.filter(byAutopilot).length,
    handedOver: inWeek.filter(
      (event) =>
        event.surface === EVENT_SURFACE.CONFIG &&
        event.operation === AUTOPILOT_OPERATION.GRANTED,
    ).length,
  };
}

/** An allow an autopilot grant made, which the gate marks with the grant's id. */
function byAutopilot(event: MemnoxEvent): boolean {
  if (event.effect !== DECISION_EFFECT.ALLOW) return false;
  const marked = `${ALLOWANCE_SIGNAL_PREFIX}${EARNED_ID_PREFIX}`;
  return (event.signals ?? []).some((signal) => signal.startsWith(marked));
}
