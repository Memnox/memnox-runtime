import { DECISION_EFFECT } from '../constants/decision.constants';
import type { RuleDraftInput } from '../daemon/policies';
import { TOOL_CLASS } from '../discovery/classify';
import { WORKSPACE_TOKEN } from './pattern-matcher';
import { POLICY_DOCUMENT_VERSION, type Policy } from './policy';
import { validatePolicyDocument } from './policy-validator';
import {
  agentPatterns,
  ANY_ACTION,
  EXCLUDE,
  readBackOfSpokenRule,
  type SpokenRuleDraft,
} from './spoken-rule';

/**
 * A rule filled in field by field on a screen, the structured twin of a spoken rule: read back in
 * the same words, held to the same validator, and written as the same kind of rule.
 */

const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);
const CLASSES: readonly string[] = Object.values(TOOL_CLASS);

/** The rule as the engine reads it, named by what it matches so a second one never replaces the first. */
export function policyOfRuleDraft(draft: RuleDraftInput): Policy {
  const sentence = readBackOfRuleDraft(draft);
  const agents = draft.agents?.flatMap(agentPatterns);
  const lists = {
    ...(draft.targets === undefined ? {} : { targets: [...draft.targets] }),
    ...(agents === undefined ? {} : { agents: [...new Set(agents)] }),
    ...(draft.workingDirectories === undefined
      ? {}
      : { workingDirectories: [...draft.workingDirectories] }),
    ...(draft.classes === undefined ? {} : { classes: [...draft.classes] }),
    ...(draft.branches === undefined ? {} : { branches: [...draft.branches] }),
  };
  return {
    name: ruleDraftName(draft),
    description: sentence,
    match: { actions: [draft.action], ...lists },
    decision: { effect: draft.effect, reason: draft.reason.trim() || sentence },
  };
}

/** What the runtime refuses in the draft, empty when it would load. */
export function ruleDraftProblems(draft: RuleDraftInput): string[] {
  if (!EFFECTS.includes(draft.effect))
    return [`effect must be one of ${EFFECTS.join(', ')}`];
  if (draft.action.trim() === '') return ['name the action the rule is about'];
  const unknown = (draft.classes ?? []).filter(
    (each) => !CLASSES.includes(each.replace(EXCLUDE, '')),
  );
  if (unknown.length > 0) return [`no such class: ${unknown.join(', ')}`];
  try {
    validatePolicyDocument({
      version: POLICY_DOCUMENT_VERSION,
      policies: [policyOfRuleDraft(draft)],
    });
    return [];
  } catch (err) {
    return err instanceof Error && 'issues' in err && Array.isArray(err.issues)
      ? err.issues.map(String)
      : [String(err)];
  }
}

/** The draft in the words a person checks before they sign it. */
export function readBackOfRuleDraft(draft: RuleDraftInput): string {
  const spoken: SpokenRuleDraft = {
    effect: draft.effect,
    operation: draft.action,
    ...(draft.agents === undefined || draft.agents.length !== 1
      ? {}
      : { agent: draft.agents[0] ?? '' }),
    ...(draft.targets === undefined ? {} : { targets: draft.targets }),
    ...(draft.classes === undefined ? {} : { classes: draft.classes }),
    ...(draft.branches === undefined ? {} : { branches: draft.branches }),
  };
  return withPlaces(readBackOfSpokenRule(spoken), draft);
}

/** Any rule in force, said the way a drafted one is read back. */
export function sentenceOfRule(policy: Policy): string {
  const { match, decision } = policy;
  return readBackOfRuleDraft({
    effect: decision.effect,
    action:
      match.actions.length === 1
        ? (match.actions[0] ?? ANY_ACTION)
        : match.actions.join(', '),
    reason: decision.reason ?? '',
    ...(match.targets === undefined ? {} : { targets: match.targets }),
    ...(match.agents === undefined ? {} : { agents: agentKindsOf(match.agents) }),
    ...(match.workingDirectories === undefined
      ? {}
      : { workingDirectories: match.workingDirectories }),
    ...(match.classes === undefined ? {} : { classes: match.classes }),
    ...(match.branches === undefined ? {} : { branches: match.branches }),
  });
}

/** What a sentence for one agent leaves out: several agents, and the folders it holds in. */
function withPlaces(sentence: string, draft: RuleDraftInput): string {
  const agents = draft.agents ?? [];
  const who = agents.length > 1 ? ` Only for ${agents.join(', ')}.` : '';
  const dirs = draft.workingDirectories ?? [];
  const where = dirs.length === 0 ? '' : ` Only in ${dirs.join(', ')}.`;
  return `${sentence}${who}${where}`;
}

/** One name per product, where a rule lists every name it is seen under. */
function agentKindsOf(patterns: readonly string[]): string[] {
  const kinds = patterns.filter((each) => !each.startsWith('agt_'));
  return [
    ...new Set(kinds.map((each) => (each.endsWith('-cli') ? each.slice(0, -4) : each))),
  ];
}

function ruleDraftName(draft: RuleDraftInput): string {
  return [
    'rule',
    draft.effect,
    ...(draft.agents ?? []),
    draft.action === ANY_ACTION ? '' : draft.action,
    ...(draft.classes ?? []),
    ...(draft.branches ?? []),
    ...(draft.targets ?? []).map((each) => each.replace(WORKSPACE_TOKEN, 'repository')),
    ...(draft.workingDirectories ?? []),
  ]
    .join('-')
    .replace(/!/g, 'not-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
