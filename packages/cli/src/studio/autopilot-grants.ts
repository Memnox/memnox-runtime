import { EarnedAllowances, inForceAt, readAutopilot, type Allowance } from '@memnox/core';

/** What the autopilot handed out and taking one back, for `memnox autopilot` and the Policy Studio alike. */

interface StandingGrants {
  on: boolean;
  grants: Allowance[];
}

/** Whether the autopilot is on, and the grants still in force whether or not it is. */
export async function standingGrants(home: string, now: string): Promise<StandingGrants> {
  const [on, all] = await Promise.all([
    readAutopilot(home),
    new EarnedAllowances(home).all(),
  ]);
  return { on, grants: all.filter((each) => inForceAt(each, now)) };
}

/** Takes one grant back at once, since it only narrows; null when no grant holds the id. */
export function revokeGrant(
  home: string,
  id: string,
  now: string,
): Promise<Allowance | null> {
  return new EarnedAllowances(home).revoke(id, now);
}
