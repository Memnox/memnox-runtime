import { DECISION_EFFECT } from '../constants/decision.constants';
import { matchesAny } from './pattern-matcher';
import { POLICY_MODE, type Policy } from './policy';

/**
 * The ask rules on this machine an allow for this action has to name to take effect. Named
 * broadly on purpose: the relaxing allow decides only where it matches itself, so listing an
 * ask that covers more than the allow does never lets through more than the allow says.
 */
export function asksToRelax(policies: readonly Policy[], action: string): string[] {
  return policies
    .filter(
      (policy) =>
        policy.decision.effect === DECISION_EFFECT.ASK &&
        policy.decision.mode !== POLICY_MODE.OBSERVE &&
        // The workspace's question is the team's to drop, never this machine's.
        policy.workspace !== true &&
        matchesAny(policy.match.actions, action),
    )
    .map((policy) => policy.name);
}
