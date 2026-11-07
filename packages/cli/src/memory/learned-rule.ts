import {
  evidenceRef,
  policyOfRuleDraft,
  ruleDraftProblems,
  type MemoryItem,
  type MemoryRule,
  type Policy,
  type RuleDraftInput,
} from '@memnox/core';

/**
 * A rule candidate turned into the rule it would be: the same draft any rule goes through, every
 * action it names, and where it was learned, written into its reason so a stop cites the note.
 */

/** The draft a screen edits, from the rule half of a candidate. */
function draftOfRule(rule: MemoryRule): RuleDraftInput {
  return {
    effect: rule.effect,
    action: rule.actions[0] ?? '',
    ...(rule.targets === undefined ? {} : { targets: [...rule.targets] }),
    ...(rule.agents === undefined ? {} : { agents: [...rule.agents] }),
    reason: rule.reason,
  };
}

/** The rule half from an edited draft, keeping the other actions the candidate named. */
export function ruleOfDraft(draft: RuleDraftInput, before?: MemoryRule): MemoryRule {
  const others = (before?.actions ?? []).slice(1).filter((each) => each !== draft.action);
  return {
    effect: draft.effect,
    actions: [draft.action, ...others],
    ...(draft.targets === undefined ? {} : { targets: [...draft.targets] }),
    ...(draft.agents === undefined ? {} : { agents: [...draft.agents] }),
    reason: draft.reason,
  };
}

/** What the validator refuses in the rule, empty when it would load. */
export function learnedRuleProblems(rule: MemoryRule): string[] {
  return ruleDraftProblems(draftOfRule(rule));
}

/** Where it was learned, as `path#heading` or a link, the passages still current first. */
function learnedFromOf(item: MemoryItem): string[] {
  const current = item.evidence.filter((each) => !each.stale);
  return [...new Set((current.length > 0 ? current : item.evidence).map(evidenceRef))];
}

/** The rule a candidate would be, or null for an item that is not a rule. */
export function learnedPolicy(item: MemoryItem): Policy | null {
  if (item.rule === undefined) return null;
  const policy = policyOfRuleDraft(draftOfRule(item.rule));
  const learnedFrom = learnedFromOf(item);
  const reason = policy.decision.reason;
  return {
    ...policy,
    match: { ...policy.match, actions: [...item.rule.actions] },
    decision: {
      ...policy.decision,
      // Said in the reason, which is the line an agent is handed when the rule stops it.
      reason:
        learnedFrom.length === 0
          ? reason
          : `${reason} (learned from ${learnedFrom.join(', ')})`,
    },
    ...(learnedFrom.length === 0 ? {} : { learnedFrom }),
  };
}
