import { basename, join } from 'node:path';
import {
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  RULE_SCOPE,
  type Policy,
  type Proposal,
  type RuleDraft,
  type RuleScope,
} from '@memnox/core';
import { machinePolicyPath } from './machine-rules';
import { WRITTEN_POLICY_FILE } from './merge-rules';

/**
 * Where a rule a person asked for is put in force. A rule file's place on disk does not limit
 * its rules, since every registered file is loaded for every agent, so a repository's rule is
 * narrowed to that folder by its own match, and holds there and nowhere else.
 */

/** The id the whole Mac is offered under, which is also the answer a CONFIRM signs for it. */
const MACHINE_SCOPE_ID = RULE_SCOPE.MACHINE;

/** A pattern for everything under a folder; the engine's `*` spans `/`, so it reaches every subfolder. */
const UNDER = '/*';

export function machineScope(suggested: boolean): RuleScope {
  return {
    id: MACHINE_SCOPE_ID,
    kind: RULE_SCOPE.MACHINE,
    label: 'This Mac',
    ...(suggested ? { suggested } : {}),
  };
}

/** The workspace, for a machine that is enrolled in one; nothing is written here, it is offered on the next sync. */
export function teamScope(): RuleScope {
  return { id: RULE_SCOPE.TEAM, kind: RULE_SCOPE.TEAM, label: 'The team' };
}

/** Numbered in the order offered, so the id the Mac signs names exactly one folder of this proposal. */
export function repositoryScope(
  folder: string,
  index: number,
  suggested: boolean,
): RuleScope {
  return {
    id: `${RULE_SCOPE.REPOSITORY}-${index + 1}`,
    kind: RULE_SCOPE.REPOSITORY,
    label: basename(folder),
    folder,
    ...(suggested ? { suggested } : {}),
  };
}

/** The file a scope's rules are merged into: the machine's own, or the repository's. */
export function fileForScope(home: string, scope: RuleScope): string {
  return scope.kind === RULE_SCOPE.REPOSITORY && scope.folder !== undefined
    ? join(scope.folder, WRITTEN_POLICY_FILE)
    : machinePolicyPath(home);
}

/** The rules as they go in force there: a repository's only match inside its folder. */
export function scopedRules(rules: readonly Policy[], scope: RuleScope): Policy[] {
  if (scope.kind !== RULE_SCOPE.REPOSITORY || scope.folder === undefined)
    return [...rules];
  const folder = scope.folder;
  return rules.map((rule) => ({
    ...rule,
    match: { ...rule.match, workingDirectories: [folder, `${folder}${UNDER}`] },
  }));
}

/**
 * The scope an answer picks: a plain "confirmed" takes the suggested one, and a scope id takes
 * that one. Undefined when the answer names no scope of these, which is refused rather than guessed.
 */
export function scopeAnswered(
  scopes: readonly RuleScope[],
  answer: string,
): RuleScope | undefined {
  if (answer === PROPOSAL_ANSWER.CONFIRMED)
    return scopes.find((scope) => scope.suggested === true) ?? scopes[0];
  return scopes.find((scope) => scope.id === answer);
}

/** A rules proposal as the Mac's card shows it; undefined for any other proposal, or one with no places offered. */
export function ruleDraftOf(proposal: Proposal): RuleDraft | undefined {
  const change = proposal.change;
  if (change.kind !== PROPOSAL_KIND.RULES || change.scopes === undefined)
    return undefined;
  const [rule] = change.rules;
  if (rule === undefined) return undefined;
  const branches = rule.match.branches;
  const targets = rule.match.targets;
  return {
    summary: proposal.rationale,
    effect: rule.decision.effect,
    action: rule.match.actions?.[0] ?? '',
    ...(branches === undefined ? {} : { branches: [...branches] }),
    ...(targets === undefined ? {} : { targets: [...targets] }),
    reason: rule.decision.reason ?? proposal.rationale,
    scopes: [...change.scopes],
  };
}
