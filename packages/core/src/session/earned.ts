import { randomBytes } from 'node:crypto';

import { DECISION_EFFECT } from '../constants/decision.constants';
import { inForceAt, type Allowance } from '../gate/allowances';
import type { MemnoxEvent } from '../event/event';
import { matchesAny } from '../policy/pattern-matcher';
import { delegations, handable, PROMOTION_THRESHOLD, type Delegation } from './autonomy';

/**
 * The autopilot: what one agent earned by being approved, handed to it for a while without
 * anybody running a command. It grants only what `memnox next --hand-over` would have
 * offered, scoped to that agent and those targets, and any refusal takes it back.
 */

/** Who every grant names, so `why` says the autopilot allowed it and never a person. */
export const AUTOPILOT_BY = 'memnox autopilot';

/** How long a grant stands before it has to be earned again on fresh evidence. */
export const EARNED_DAYS = 7;

/** How far back the evidence is read. */
export const EARNED_WINDOW_DAYS = 30;

/** A target named like production is never handed over on approvals alone. */
const PRODUCTION_WORDS = /\b(prod|production|live)\b/i;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface EarnedGrant {
  agent: string;
  allowance: Allowance;
  delegation: Delegation;
}

export interface Revocation {
  allowance: Allowance;
  /** The refusal that ended it. */
  refusal: MemnoxEvent;
}

/**
 * New grants this evidence supports, per agent. Nothing is granted that is already held,
 * that named no target, or that reached production.
 */
export function earnedGrants(
  events: readonly MemnoxEvent[],
  held: readonly Allowance[],
  context: { now: string; threshold?: number; id?: () => string },
): EarnedGrant[] {
  const threshold = context.threshold ?? PROMOTION_THRESHOLD;
  const nextId = context.id ?? (() => `ern_${randomBytes(4).toString('hex')}`);
  const until = new Date(Date.parse(context.now) + EARNED_DAYS * DAY_MS).toISOString();
  const grants: EarnedGrant[] = [];
  for (const [agent, own] of byAgent(events)) {
    for (const delegation of delegations(own, threshold)) {
      if (!handable(delegation, threshold)) continue;
      // An approval that named no target would become the action everywhere.
      if (delegation.targets.length === 0) continue;
      if (delegation.targets.some((target) => PRODUCTION_WORDS.test(target))) continue;
      if (holds(held, agent, delegation.action, context.now)) continue;
      grants.push({
        agent,
        delegation,
        allowance: {
          id: nextId(),
          actions: [delegation.action],
          targets: delegation.targets,
          agents: [agent],
          by: AUTOPILOT_BY,
          reason: `approved ${delegation.approvals} times with no refusal`,
          since: context.now,
          until,
        },
      });
    }
  }
  return grants;
}

/** Grants a refusal since they began has taken back: one no outranks the yeses that earned it. */
export function revokedByRefusal(
  events: readonly MemnoxEvent[],
  held: readonly Allowance[],
  now: string,
): Revocation[] {
  const found: Revocation[] = [];
  for (const allowance of held) {
    if (!inForceAt(allowance, now)) continue;
    const refusal = events.find(
      (event) =>
        event.effect === DECISION_EFFECT.DENY &&
        event.at >= allowance.since &&
        matchesAny(allowance.actions, event.operation) &&
        matchesAny(allowance.agents, event.agent),
    );
    if (refusal !== undefined) found.push({ allowance, refusal });
  }
  return found;
}

/** Where the evidence starts, for a reader of the ledger. */
export function earnedWindowStart(now: string): string {
  return new Date(Date.parse(now) - EARNED_WINDOW_DAYS * DAY_MS).toISOString();
}

function byAgent(events: readonly MemnoxEvent[]): Map<string, MemnoxEvent[]> {
  const grouped = new Map<string, MemnoxEvent[]>();
  for (const event of events) {
    const own = grouped.get(event.agent) ?? [];
    own.push(event);
    grouped.set(event.agent, own);
  }
  return grouped;
}

function holds(
  held: readonly Allowance[],
  agent: string,
  action: string,
  now: string,
): boolean {
  return held.some(
    (each) =>
      inForceAt(each, now) &&
      each.actions.includes(action) &&
      (each.agents ?? []).includes(agent),
  );
}
