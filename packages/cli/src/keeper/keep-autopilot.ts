/**
 * The daemon's autopilot pass: takes back what a refusal undid, then hands each agent what
 * it earned since the last pass. It runs only where a person turned `autopilot` on.
 */
import {
  earnedGrants,
  earnedWindowStart,
  EarnedAllowances,
  LEDGER_SCAN_LIMIT,
  openLedger,
  readAutopilot,
  revokedByRefusal,
  TOOL_CLASS,
  type EarnedGrant,
  type MemnoxEvent,
  type Revocation,
} from '@memnox/core';

import { CONFIG_RULE, recordConfigChanges, type ConfigRecord } from './config-events';

const OPERATION = {
  GRANTED: 'autopilot.granted',
  REVOKED: 'autopilot.revoked',
} as const;

interface AutopilotPass {
  granted: EarnedGrant[];
  revoked: Revocation[];
}

const NOTHING: AutopilotPass = { granted: [], revoked: [] };

/** One pass. A ledger that will not open grants nothing, since no evidence is no earning. */
export async function autopilotOnce(home: string, now: Date): Promise<AutopilotPass> {
  if (!(await readAutopilot(home))) return NOTHING;
  const events = await evidence(home, now);
  if (events === null) return NOTHING;

  const at = now.toISOString();
  const store = new EarnedAllowances(home);
  const revoked = revokedByRefusal(events, await store.inForce(at), at);
  for (const each of revoked) await store.revoke(each.allowance.id, at);

  const granted = earnedGrants(events, await store.inForce(at), { now: at });
  for (const each of granted) await store.add(each.allowance);

  await recordConfigChanges(
    home,
    [...revoked.map(revokedRecord), ...granted.map(grantedRecord)],
    now,
  );
  return { granted, revoked };
}

/** What a person is told, one line per change, each naming the command that undoes it. */
export function describeAutopilot(pass: AutopilotPass): string[] {
  return [
    ...pass.revoked.map(
      (each) =>
        `Autopilot took back ${each.allowance.actions.join(', ')} from ${(each.allowance.agents ?? []).join(', ')}: it was refused at ${each.refusal.at}, so it asks again.`,
    ),
    ...pass.granted.map(
      (each) =>
        `Autopilot handed ${each.agent} ${each.delegation.action} on ${targetsOf(each)} until ${each.allowance.until}: you approved it ${each.delegation.approvals} times and never refused. memnox autopilot --revoke ${each.allowance.id} takes it back.`,
    ),
  ];
}

async function evidence(home: string, now: Date): Promise<MemnoxEvent[] | null> {
  const ledger = openLedger(home);
  if (ledger === null) return null;
  try {
    return await ledger.query({
      since: earnedWindowStart(now.toISOString()),
      limit: LEDGER_SCAN_LIMIT,
    });
  } finally {
    ledger.close();
  }
}

function grantedRecord(each: EarnedGrant): ConfigRecord {
  return {
    operation: OPERATION.GRANTED,
    agent: each.agent,
    summary: `${each.delegation.action} on ${targetsOf(each)} allowed until ${each.allowance.until}, approved ${each.delegation.approvals} times with no refusal (${each.allowance.id})`,
    class: TOOL_CLASS.WRITE,
    rule: CONFIG_RULE.AUTOPILOT,
  };
}

function revokedRecord(each: Revocation): ConfigRecord {
  return {
    operation: OPERATION.REVOKED,
    agent: (each.allowance.agents ?? [])[0] ?? 'memnox daemon',
    summary: `${each.allowance.actions.join(', ')} taken back after a refusal at ${each.refusal.at} (${each.allowance.id})`,
    class: TOOL_CLASS.WRITE,
    rule: CONFIG_RULE.AUTOPILOT,
  };
}

function targetsOf(each: EarnedGrant): string {
  const targets = each.allowance.targets ?? [];
  return targets.length === 1 ? (targets[0] ?? '') : `${targets.length} targets`;
}
