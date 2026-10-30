import {
  almostReady,
  daysToMs,
  DECISION_EFFECT,
  delegations,
  describeAllowance,
  ENFORCEMENT_MODE,
  EVENT_SURFACE,
  handable,
  ladderOf,
  LEDGER_SCAN_LIMIT,
  loadOrCreateConfig,
  promotable,
  standingOf,
  weeksOfProgress,
  type Allowance,
  type MemnoxEvent,
  type ProgressGrant,
  type ProgressView,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { policySetInForce } from '../policy-path';
import { standingGrants } from './autopilot-grants';

/**
 * How far the agents have been let go, read from the ledger and the grants: counts only, never
 * hours saved, since a count can be checked against the record and an estimate cannot.
 */

/** How far back the record is read for what could be handed over, as the home reads it. */
const READY_WINDOW_DAYS = 30;
const WEEK_DAYS = 7;

export async function readProgress(home: string, now: Date): Promise<ProgressView> {
  const since = new Date(now.getTime() - daysToMs(READY_WINDOW_DAYS)).toISOString();
  const [events, grants, config, set] = await Promise.all([
    withEvents(home, (store) =>
      store.query({ since, limit: LEDGER_SCAN_LIMIT, withConfig: true }),
    ),
    standingGrants(home, now.toISOString()),
    loadOrCreateConfig(home),
    policySetInForce(home),
  ]);
  const work = events.filter((event) => event.surface !== EVENT_SURFACE.CONFIG);
  const found = delegations(work);
  const week = weekOf(work, now);
  const level = standingOf({
    enforcing: config.mode === ENFORCEMENT_MODE.ENFORCE,
    rules: set.policies.length,
    asksInWindow: week.asks,
    actionsInWindow: week.actions,
  });
  return {
    ready: promotable(found)
      .filter((each) => handable(each))
      .map(({ action, approvals, targets, because }) => ({
        action,
        approvals,
        targets: [...targets],
        because,
      })),
    almost: almostReady(found),
    grants: grants.grants.map(grantOf),
    autopilotOn: grants.on,
    ladder: ladderOf(level, week),
    ...weeksOfProgress(events, now),
  };
}

function weekOf(
  work: readonly MemnoxEvent[],
  now: Date,
): { actions: number; asks: number } {
  const from = new Date(now.getTime() - daysToMs(WEEK_DAYS)).toISOString();
  const inWeek = work.filter((event) => event.at >= from);
  return {
    actions: inWeek.length,
    asks: inWeek.filter((event) => event.effect === DECISION_EFFECT.ASK).length,
  };
}

function grantOf(grant: Allowance): ProgressGrant {
  return {
    id: grant.id,
    actions: [...grant.actions],
    targets: [...(grant.targets ?? [])],
    agents: [...(grant.agents ?? [])],
    since: grant.since,
    until: grant.until,
    says: describeAllowance(grant),
  };
}
