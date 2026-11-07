import {
  DECISION_EFFECT,
  RULE_SOURCE,
  type PolicyRuleView,
  type RuleSource,
} from '@memnox/core';
import { readRulesView } from '../studio/rules-in-force';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { readTool, type ToolDefinition } from './session-tools';
import { MACHINE } from '../this-machine';

/**
 * The rules in force on this machine for the voice to read out: counts first and a few plain lines
 * at a time, from the same reader the Policies page draws, so the voice and the screen never disagree.
 */

/** Enough to say a few aloud and offer more, never the whole set put in front of the brain. */
const RULES_PER_PAGE = 8;

const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);

/** Where a rule came from, in the words a person would say it. */
const FROM_WORDS: Record<RuleSource, string> = {
  [RULE_SOURCE.PERSON]: `added on this ${MACHINE}`,
  [RULE_SOURCE.EXTRACTED]: `learned and confirmed on this ${MACHINE}`,
  [RULE_SOURCE.FILE]: 'a repository rule file',
  [RULE_SOURCE.WORKSPACE]: 'the team workspace',
  [RULE_SOURCE.DEFAULT]: 'the baseline setup wrote',
  [RULE_SOURCE.AUTOPILOT]: 'handed over by the autopilot for a while',
  [RULE_SOURCE.ALLOWANCE]: 'allowed for a while',
  [RULE_SOURCE.FREEZE]: 'a pause or freeze',
};

/** Offered to the voice's brain beside sources and memory, and reads only. */
export const RULES_IN_FORCE_TOOL: ToolDefinition = readTool(
  'rules_in_force',
  `Every rule in force on this ${MACHINE}, from the same reader as its Policies page: how many, by effect and by where each came from, then one plain line per rule with its name, effect allow, ask or deny, what it matches, the agents it names and where it came from, such as added here, a repository file or the team workspace. A few lines a time, with cursor for more. Answer "what rules do we have", "list them", "what is denied" and "is there a rule about pushing" from here, never from status or the console.`,
  {
    effect: {
      type: 'string',
      description: 'allow, ask or deny; every effect when left out',
    },
    about: {
      type: 'string',
      description:
        'one word a rule names, such as "push", "main", "codex" or "workspace"',
    },
    cursor: {
      type: 'string',
      description: 'the next an earlier answer gave, for more',
    },
  },
);

const READ_THEM =
  'Read them in plain words a few at a time, by what each does rather than its name, and offer the rest; pass next as cursor for more, and effect or about to narrow.';

export async function rulesInForceTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const view = await readRulesView(deps.home, deps.now());
  const effect = textArg(args, 'effect')?.toLowerCase();
  if (effect !== undefined && !EFFECTS.includes(effect))
    return { said: 'Pass effect as allow, ask or deny, or leave it out.' };
  const about = textArg(args, 'about')?.toLowerCase();
  const matching = view.rules.filter(
    (rule) =>
      (effect === undefined || rule.effect === effect) &&
      (about === undefined || mentions(rule, about)),
  );
  const from = startOf(textArg(args, 'cursor'));
  const page = matching.slice(from, from + RULES_PER_PAGE);
  const after = from + page.length;
  return {
    inForce: view.rules.length,
    byEffect: countBy(view.rules, (rule) => rule.effect),
    from: countBy(view.rules, (rule) => FROM_WORDS[rule.source]),
    ...(effect === undefined && about === undefined ? {} : { matching: matching.length }),
    rules: page.map(ruleLine),
    ...(after < matching.length
      ? { more: matching.length - after, next: String(after) }
      : {}),
    ...(view.problems.length === 0
      ? {}
      : {
          notLoaded: view.problems.map(
            (problem) => `${problem.file}: ${problem.issues.join('; ')}`,
          ),
        }),
    read: READ_THEM,
  };
}

/** One rule as one line: what it does, its effect, and where it came from. */
function ruleLine(rule: PolicyRuleView): string {
  const agents =
    rule.match.agents === undefined ? '' : `; agents ${rule.match.agents.join(', ')}`;
  const until = rule.until === undefined ? '' : `; until ${rule.until}`;
  // The reason is what a person asks next, so it rides along unless the sentence already says it.
  const said = rule.sentence.toLowerCase();
  const because =
    rule.reason === undefined || said.includes(rule.reason.toLowerCase())
      ? ''
      : ` Because ${rule.reason}.`;
  return `${rule.name}: ${rule.effect}, ${rule.sentence}${because} (from ${FROM_WORDS[rule.source]}${agents}${until})`;
}

function mentions(rule: PolicyRuleView, word: string): boolean {
  const { match } = rule;
  return [
    rule.name,
    rule.sentence,
    rule.reason ?? '',
    FROM_WORDS[rule.source],
    ...match.actions,
    ...(match.targets ?? []),
    ...(match.agents ?? []),
    ...(match.branches ?? []),
  ].some((each) => each.toLowerCase().includes(word));
}

function startOf(cursor: string | undefined): number {
  const start = Number(cursor ?? 0);
  return Number.isInteger(start) && start > 0 ? start : 0;
}

function countBy(
  rules: readonly PolicyRuleView[],
  key: (rule: PolicyRuleView) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rule of rules) counts[key(rule)] = (counts[key(rule)] ?? 0) + 1;
  return counts;
}
