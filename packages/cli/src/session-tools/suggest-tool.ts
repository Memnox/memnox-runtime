import {
  DECISION_EFFECT,
  MEMORY_KIND,
  MEMORY_KINDS,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  SqliteMemoryStore,
  type DecisionEffect,
  type MemoryKind,
  type MemoryRule,
  type NewMemoryItem,
} from '@memnox/core';
import { repositoryRootOf } from '@memnox/interceptors';
import { learnedRuleProblems } from '../memory/learned-rule';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * An agent proposing something it learned: a fact, a convention or a rule. It goes into the same
 * Learn queue as what was read from the person's notes and is never promoted by itself: only the
 * person's confirm makes it a fact, and only their signature makes a rule hold.
 */

const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);
const MOST_STATEMENT_CHARS = 500;

const QUEUED =
  'Waiting in Learn for your person. It is not a fact and not a rule until they confirm it, so do not act on it as either.';

export async function suggestTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const read = suggestionOf(deps, args);
  if ('refused' in read) return read;
  const store = SqliteMemoryStore.forHome(deps.home);
  try {
    const outcome = store.add(read, deps.now().toISOString());
    if ('rejectedBefore' in outcome)
      return {
        said: 'Your person already rejected this, so it was not suggested again.',
      };
    if ('merged' in outcome)
      return { queued: outcome.merged, said: `Already suggested. ${QUEUED}` };
    return { queued: outcome.added.id, said: QUEUED };
  } finally {
    store.close();
  }
}

function suggestionOf(
  deps: SessionToolDeps,
  args: ToolArgs,
): NewMemoryItem | { refused: string } {
  const kind = textArg(args, 'kind') ?? MEMORY_KIND.FACT;
  if (!MEMORY_KINDS.includes(kind))
    return { refused: `kind is one of ${MEMORY_KINDS.join(', ')}` };
  const statement = textArg(args, 'statement');
  if (statement === undefined) return { refused: 'say what you learned in statement' };
  const rule = kind === MEMORY_KIND.RULE ? ruleOf(args) : undefined;
  if (rule !== undefined && 'refused' in rule) return rule;
  const root = repositoryRootOf(deps.cwd);
  return {
    // Cast is safe: checked against the kinds above.
    kind: kind as MemoryKind,
    statement: statement.slice(0, MOST_STATEMENT_CHARS),
    subject: textArg(args, 'about') ?? '',
    scope: root === null ? MEMORY_SCOPE.PERSONAL : MEMORY_SCOPE.PROJECT,
    ...(root === null ? {} : { project: root }),
    origin: MEMORY_ORIGIN.AGENT,
    tainted: false,
    suggestedBy: deps.agent,
    ...(rule === undefined ? {} : { rule }),
    evidence: [],
  };
}

function ruleOf(args: ToolArgs): MemoryRule | { refused: string } {
  const said = textArg(args, 'effect') ?? DECISION_EFFECT.ASK;
  if (!EFFECTS.includes(said))
    return { refused: `effect is one of ${EFFECTS.join(', ')}` };
  const actions = listArg(args, 'actions');
  if (actions.length === 0) return { refused: 'a rule names the actions it is about' };
  const targets = listArg(args, 'targets');
  const rule: MemoryRule = {
    // Cast is safe: checked against the engine's own effects above.
    effect: said as DecisionEffect,
    actions,
    ...(targets.length === 0 ? {} : { targets }),
    reason: textArg(args, 'reason') ?? '',
  };
  const problems = learnedRuleProblems(rule);
  return problems.length === 0
    ? rule
    : { refused: `the rule would not load: ${problems.join('; ')}` };
}

function listArg(args: ToolArgs, name: string): string[] {
  return (textArg(args, name) ?? '').split(/[\s,]+/).filter((each) => each !== '');
}
