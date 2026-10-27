import {
  asksToRelax,
  DECISION_EFFECT,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  readAccount,
  TOOL_CLASS,
  type HoldRequest,
  type Policy,
  type RuleScope,
} from '@memnox/core';

import { fileForScope, machineScope, teamScope } from '../protect/rule-scope';
import { rulesInForce } from '../protect/written-rules';

/**
 * "Allow from now on" on a held call: it runs once, and a narrow rule naming the asks it
 * relaxes goes on a card the person places and signs: this agent, action and target only.
 */

/** The answer word a device signs for it, beside once, session and deny. */
export const FROM_NOW_ON = 'always';

/** "Deny from now on": refused now, unsigned as any no, and a deny rule for the next one put on a card to sign. */
export const NEVER_FROM_NOW_ON = 'never';

/** As long as any other rule card waits for its signature. */
const CARD_TTL_MS = minutesToMs(5);

/** Who the proposal is from, as every other rule card names it. */
const PROPOSED_BY = 'agt_memnox-operator';

type FromNowOn = { proposed: string } | { notProposed: string };

export async function proposeFromNowOn(
  home: string,
  request: HoldRequest,
  at: string,
): Promise<FromNowOn> {
  // A yes to a delete is a yes to that delete, here as it is for a session.
  if (request.class === TOOL_CLASS.DESTRUCTIVE) {
    return { notProposed: 'a delete is answered one at a time, never from now on' };
  }
  const inForce = await rulesInForce([], home);
  const asking = inForce.find((rule) => rule.name === request.rule);
  if (asking?.workspace === true) {
    return {
      notProposed: `the team's rule ${asking.name} asked this, so only the team can change it`,
    };
  }
  const relaxes = asksToRelax(inForce, request.operation);
  if (relaxes.length === 0) {
    return {
      notProposed:
        'Memnox asked this on its own account, a new agent or a write outside the repository, which no rule hands over',
    };
  }
  const scopes = await placesOf(home);
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.RULES,
      file: fileForScope(home, machineScope(true)),
      rules: [ruleFor(request, relaxes)],
      scopes,
    },
    rationale: `allow ${request.operation}${request.target === undefined ? '' : ` on ${request.target}`} for ${request.agent} from now on`,
    proposedBy: PROPOSED_BY,
    at,
    ttlMs: CARD_TTL_MS,
  });
  return { proposed: proposal.id };
}

/**
 * The deny for the next identical call, carrying the person's reason as the rule's own, so an agent refused by it
 * later hears why. Tightening needs no rule to relax, so it is offered wherever a call was held.
 */
export async function proposeNeverFromNowOn(
  home: string,
  request: HoldRequest,
  at: string,
  reason?: string,
): Promise<FromNowOn> {
  const scopes = await placesOf(home);
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.RULES,
      file: fileForScope(home, machineScope(true)),
      rules: [denyRuleFor(request, reason)],
      scopes,
    },
    rationale: `deny ${request.operation}${request.target === undefined ? '' : ` on ${request.target}`} for ${request.agent} from now on${reason === undefined ? '' : `: ${reason}`}`,
    proposedBy: PROPOSED_BY,
    at,
    ttlMs: CARD_TTL_MS,
  });
  return { proposed: proposal.id };
}

function denyRuleFor(request: HoldRequest, reason: string | undefined): Policy {
  return {
    name: ruleName('never', request),
    description: `Denied from now on, from the held call on ${request.operation}.`,
    match: matchOf(request),
    decision: {
      effect: DECISION_EFFECT.DENY,
      reason: reason ?? `a person denied ${request.operation} from now on`,
    },
  };
}

function ruleName(prefix: string, request: HoldRequest): string {
  return [prefix, request.agent, request.operation, request.target ?? '']
    .join('-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function matchOf(request: HoldRequest): Policy['match'] {
  return {
    actions: [request.operation],
    agents: [request.agent],
    ...(request.target === undefined ? {} : { targets: [request.target] }),
  };
}

/** The whole Mac, suggested, and the team where this Mac belongs to one. */
async function placesOf(home: string): Promise<RuleScope[]> {
  return [
    machineScope(true),
    ...((await readAccount(home)) === null ? [] : [teamScope()]),
  ];
}

function ruleFor(request: HoldRequest, relaxes: readonly string[]): Policy {
  return {
    name: ruleName('always', request),
    description: `Allowed from now on, from the held call on ${request.operation}.`,
    match: matchOf(request),
    decision: {
      effect: DECISION_EFFECT.ALLOW,
      reason: `a person allowed ${request.operation} from now on`,
      relaxes: [...relaxes],
    },
  };
}
