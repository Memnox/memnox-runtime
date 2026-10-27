import { matchesPattern } from '../policy/pattern-matcher';
import type { Policy } from '../policy/policy';
import { capabilitiesOf } from './capabilities';
import type { DiscoveryReport } from './discover';

/**
 * How much of what an agent can do has a rule about it: the closing line of the scan,
 * counted by matching rules against actions, never by counting rule files.
 */
export interface Gap {
  total: number;
  governed: number;
}

/** Every action a rule could be written about, so "governed" is counted not guessed. */
export function reachingActions(report: DiscoveryReport): string[] {
  return capabilitiesOf(report).map((capability) => capability.action);
}

/** The gap, counted rather than asserted: "governed" means a rule actually matches the action. */
export function measureGap(report: DiscoveryReport, policies: readonly Policy[]): Gap {
  const actions = reachingActions(report);
  const governed = actions.filter((action) =>
    policies.some((policy) =>
      (policy.match.actions ?? []).some((pattern) => matchesPattern(pattern, action)),
    ),
  );
  return { total: actions.length, governed: governed.length };
}

export function gapLines(gap: Gap): string[] {
  const noun = gap.total === 1 ? 'capability' : 'capabilities';
  const verb = gap.governed === 1 ? 'is' : 'are';
  return [
    `${gap.total} ${noun} can change something outside this laptop.`,
    gap.governed === 0
      ? 'None of them is governed by a policy.'
      : `${gap.governed} of them ${verb} governed by a policy.`,
  ];
}
