import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  DECIDED_RULES_FILE,
  MEMNOX_HOME,
  readAccount,
  readJsonFile,
  writeJsonFile,
  type Policy,
} from '@memnox/core';

import { CLOUD_EVENT, eventOf, type CloudEvent } from './cloud-event';

/**
 * Rules a person decided on this machine, kept until the next sync offers them to the
 * team. The control plane only ever turns one into a proposal a second admin approves.
 */

/** Enough to cover a busy week between syncs; older ones were offered already or are stale. */
const KEPT = 200;

/** The three effects, and a person may decide any of them here. */
type DecidedEffect = 'allow' | 'ask' | 'deny';

/** What narrows a rule past its action and agent, in the match fields the control plane reads. */
interface DecisionScope {
  targets?: string[];
  dataClassifications?: string[];
  classes?: string[];
  branches?: string[];
  alternative?: { action: string; note: string };
}

interface LocalDecision extends DecisionScope {
  /** Stable for one rule decided once, so a resend is one proposal on the other side. */
  ref: string;
  operation: string;
  effect: DecidedEffect;
  agent?: string;
  decidedAt: string;
}

const SCOPE_LISTS = ['targets', 'dataClassifications', 'classes', 'branches'] as const;

interface DecisionsFile {
  decisions: LocalDecision[];
}

function decisionsPathFor(home: string): string {
  return join(home, MEMNOX_HOME, DECIDED_RULES_FILE);
}

/** Content derived, so writing the same rule twice records it once; a scope only adds to the digest. */
export function decisionRef(
  effect: DecidedEffect,
  operation: string,
  agent?: string,
  scope: DecisionScope = {},
): string {
  const narrowed = scopeOf(scope);
  const digest = createHash('sha256')
    .update(
      [
        effect,
        operation,
        agent ?? '',
        ...(Object.keys(narrowed).length === 0 ? [] : [JSON.stringify(narrowed)]),
      ].join(' '),
    )
    .digest('hex');
  return `dec_${digest.slice(0, 24)}`;
}

/** Only the scope fields that narrow anything, in one order, so a digest never depends on spelling. */
function scopeOf(scope: DecisionScope): DecisionScope {
  const lists = SCOPE_LISTS.flatMap((key) => {
    const values = scope[key];
    return values === undefined || values.length === 0
      ? []
      : [[key, [...values]] as const];
  });
  return {
    ...(Object.fromEntries(lists) as DecisionScope),
    ...(scope.alternative === undefined ? {} : { alternative: { ...scope.alternative } }),
  };
}

/**
 * The rules a person signed, one decision per action, carrying everything that narrows them.
 * The agent goes as the first one named, since a team rule is narrowed to one agent or to none.
 */
export function decisionsOfRules(
  rules: readonly Policy[],
  decidedAt: string,
): Omit<LocalDecision, 'ref'>[] {
  return rules.flatMap((rule) =>
    rule.match.actions.map((operation) => ({
      operation,
      effect: rule.decision.effect,
      decidedAt,
      ...(rule.match.agents?.[0] === undefined ? {} : { agent: rule.match.agents[0] }),
      ...scopeOf({
        ...(rule.match.targets === undefined ? {} : { targets: rule.match.targets }),
        ...(rule.match.dataClassifications === undefined
          ? {}
          : { dataClassifications: rule.match.dataClassifications }),
        ...(rule.match.classes === undefined ? {} : { classes: rule.match.classes }),
        ...(rule.match.branches === undefined ? {} : { branches: rule.match.branches }),
        ...(rule.decision.alternative === undefined
          ? {}
          : {
              alternative: {
                action: rule.decision.alternative.action,
                note: rule.decision.alternative.note,
              },
            }),
      }),
    })),
  );
}

export async function readLocalDecisions(home: string): Promise<LocalDecision[]> {
  const held = await readJsonFile<Partial<DecisionsFile>>(decisionsPathFor(home));
  return held === null || !Array.isArray(held.decisions) ? [] : held.decisions;
}

/**
 * Keeps what a person just decided, on an enrolled machine only: a machine with no account
 * has no team to offer it to, and one enrolled later should not surface last year's choices.
 */
export async function recordLocalDecisions(
  home: string,
  decided: readonly Omit<LocalDecision, 'ref'>[],
): Promise<number> {
  if (decided.length === 0 || (await readAccount(home)) === null) return 0;
  const held = await readLocalDecisions(home);
  const known = new Set(held.map((each) => each.ref));
  const added = decided
    .map((each) => ({
      ...each,
      ref: decisionRef(each.effect, each.operation, each.agent, each),
    }))
    .filter((each) => !known.has(each.ref));
  if (added.length === 0) return 0;
  await writeJsonFile(decisionsPathFor(home), {
    decisions: [...held, ...added].slice(-KEPT),
  });
  return added.length;
}

/** One event per decision; who decided is the machine's owner, never a field in here. */
export function localDecisionEvents(decisions: readonly LocalDecision[]): CloudEvent[] {
  return decisions.map((decision) =>
    eventOf({
      kind: CLOUD_EVENT.RULE_DECIDED_LOCALLY,
      dedupKey: `${CLOUD_EVENT.RULE_DECIDED_LOCALLY}:${decision.ref}`,
      subjectId: decision.ref,
      occurredAt: Date.parse(decision.decidedAt),
      payload: {
        ref: decision.ref,
        operation: decision.operation,
        effect: decision.effect,
        ...(decision.agent === undefined ? {} : { agent: decision.agent }),
        ...scopeOf(decision),
      },
    }),
  );
}
