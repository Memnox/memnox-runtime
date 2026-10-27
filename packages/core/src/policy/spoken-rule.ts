import { DECISION_EFFECT, type DecisionEffect } from '../constants/decision.constants';
import { TOOL_CLASS } from '../discovery/classify';
import { DATA_CLASSIFICATIONS } from '../domain/sensitive-data';
import { resolveAgentName } from './agent-pause';
import { WORKSPACE_TOKEN } from './pattern-matcher';
import { POLICY_DOCUMENT_VERSION, type Policy } from './policy';
import { validatePolicyDocument } from './policy-validator';

/**
 * A rule a person said, in the runtime's own match fields: what the sentence grammar reads and
 * what a model's draft must come back as, checked by the same validator every policy file passes.
 */

/** One rule as a person meant it, before it is named and written. */
export interface SpokenRuleDraft {
  effect: DecisionEffect;
  /** One action pattern; `*` with `classes` where the sentence named a kind of action. */
  operation: string;
  /** The agent kind it was narrowed to, where the person named one. */
  agent?: string;
  /** Wildcards over what the action touches; a leading `!` leaves one out. */
  targets?: string[];
  dataClassifications?: string[];
  classes?: string[];
  branches?: string[];
  alternative?: { action: string; note: string };
}

/** What a sentence was read as, and what it left for the person to say. */
export interface SpokenRuleReading {
  draft: SpokenRuleDraft;
  openQuestions: string[];
}

export const ANY_ACTION = '*';
export const EXCLUDE = '!';

/** Asked whenever a sentence says "approved" and names none, since a guessed list is a hole. */
export const APPROVED_DESTINATIONS_QUESTION =
  'Which destinations are approved? Name each one and the rule leaves it out.';

const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);
const CLASSES: readonly string[] = Object.values(TOOL_CLASS);
const CLASSIFICATIONS: readonly string[] = DATA_CLASSIFICATIONS;

/** How each kind of data is said back; a kind added to the vocabulary later is said as its own word. */
const DATA_SAID: Readonly<Record<string, string>> = {
  sensitive: 'sensitive data',
  secret: 'secrets',
  financial: 'financial data',
  health: 'health records',
  'government-id': 'government ids',
  'personal-data': 'personal data',
  'customer-record': 'customer records',
  confidential: 'confidential material',
  'source-code': 'source code',
  'bulk-records': 'bulk exports',
};

/** The verbs a read back uses for the action patterns the grammar writes. */
const OPERATION_SAID: Readonly<Record<string, string>> = {
  'git.push*': 'push',
  'git.push-force*': 'force push',
  '*merge*': 'merge',
  '*deploy*': 'deploy',
  '*publish*': 'publish',
  '*install*': 'install',
};

const CLASS_SAID: Readonly<Record<string, string>> = {
  [TOOL_CLASS.DESTRUCTIVE]: 'delete',
  [TOOL_CLASS.READ]: 'read',
  [TOOL_CLASS.WRITE]: 'change',
  [TOOL_CLASS.COMMUNICATION]: 'send',
};

/** Every name one product is seen under: the hook's kind, a shell's launcher and the console's id. */
export function agentPatterns(kind: string): string[] {
  const bare = kind.endsWith('-cli') ? kind.slice(0, -'-cli'.length) : kind;
  return [...new Set([kind, bare, `agt_${kind}`])];
}

/** The rule as the engine reads it; the name is unique to what it matches, so a second rule never replaces the first. */
export function policyOfSpokenRule(draft: SpokenRuleDraft): Policy {
  const readBack = readBackOfSpokenRule(draft);
  const lists = {
    ...(draft.agent === undefined ? {} : { agents: agentPatterns(draft.agent) }),
    ...(draft.targets === undefined ? {} : { targets: [...draft.targets] }),
    ...(draft.dataClassifications === undefined
      ? {}
      : { dataClassifications: [...draft.dataClassifications] }),
    ...(draft.classes === undefined ? {} : { classes: [...draft.classes] }),
    ...(draft.branches === undefined ? {} : { branches: [...draft.branches] }),
  };
  return {
    name: spokenRuleName(draft),
    description: readBack,
    match: { actions: [draft.operation], ...lists },
    decision: {
      effect: draft.effect,
      reason: readBack,
      ...(draft.alternative === undefined
        ? {}
        : { alternative: { ...draft.alternative } }),
    },
  };
}

function spokenRuleName(draft: SpokenRuleDraft): string {
  return [
    'spoken',
    draft.effect,
    draft.agent ?? '',
    draft.operation === ANY_ACTION ? '' : draft.operation,
    ...(draft.classes ?? []),
    ...(draft.dataClassifications ?? []),
    ...(draft.branches ?? []),
    ...(draft.targets ?? []).map((each) => each.replace(WORKSPACE_TOKEN, 'repository')),
  ]
    .join('-')
    .replace(/!/g, 'not-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** What the runtime's own validator refuses in the rule, empty when it would load. */
export function spokenRuleProblems(draft: SpokenRuleDraft): string[] {
  try {
    validatePolicyDocument({
      version: POLICY_DOCUMENT_VERSION,
      policies: [policyOfSpokenRule(draft)],
    });
    return [];
  } catch (err) {
    return err instanceof Error && 'issues' in err && Array.isArray(err.issues)
      ? err.issues.map(String)
      : [String(err)];
  }
}

/**
 * A draft from a model's answer, or undefined where any field falls outside the runtime's own
 * words: a fourth effect, a class or a kind of data nobody classifies, an agent nobody runs.
 */
export function spokenRuleFromModel(raw: unknown): SpokenRuleReading | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fields = raw as Record<string, unknown>;
  const effect = textIn(fields['effect']);
  const operation = textIn(fields['operation']);
  if (effect === undefined || !EFFECTS.includes(effect) || operation === undefined)
    return undefined;
  const lists = listsIn(fields);
  if (lists === undefined) return undefined;
  const agent = agentIn(fields['agent']);
  if (agent === null) return undefined;
  const alternative = alternativeIn(fields['alternative']);
  const draft: SpokenRuleDraft = {
    // Checked against the engine's own list just above.
    effect: effect as DecisionEffect,
    operation,
    ...(agent === undefined ? {} : { agent }),
    ...lists,
    ...(alternative === undefined ? {} : { alternative }),
  };
  if (spokenRuleProblems(draft).length > 0) return undefined;
  const questions = fields['openQuestions'];
  const openQuestions = Array.isArray(questions)
    ? questions.filter(
        (each): each is string => typeof each === 'string' && each.trim() !== '',
      )
    : [];
  return { draft, openQuestions };
}

function textIn(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The four lists, each only where it holds patterns; undefined when one names a word the runtime lacks. */
function listsIn(
  fields: Record<string, unknown>,
):
  | Pick<SpokenRuleDraft, 'targets' | 'dataClassifications' | 'classes' | 'branches'>
  | undefined {
  const out: Record<string, string[]> = {};
  for (const key of ['targets', 'dataClassifications', 'classes', 'branches']) {
    const value = fields[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || !value.every((each) => textIn(each) !== undefined))
      return undefined;
    const list = value.map((each) => String(each).trim());
    if (list.length > 0) out[key] = list;
  }
  const known = (list: string[] | undefined, words: readonly string[]): boolean =>
    (list ?? []).every((each) => words.includes(each.replace(EXCLUDE, '')));
  if (!known(out['dataClassifications'], CLASSIFICATIONS)) return undefined;
  if (!known(out['classes'], CLASSES)) return undefined;
  return out;
}

/** Undefined where none was named, null where one was named that is no agent this runtime knows. */
function agentIn(value: unknown): string | null | undefined {
  const said = textIn(value);
  if (said === undefined) return undefined;
  const named = resolveAgentName({ said });
  return 'kind' in named ? named.kind : null;
}

function alternativeIn(value: unknown): SpokenRuleDraft['alternative'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const action = textIn(fields['action']);
  const note = textIn(fields['note']);
  return action === undefined || note === undefined ? undefined : { action, note };
}

/** "a or b", "a, b or c". */
function either(values: readonly string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1] ?? ''}`;
}

function placeSaid(pattern: string): string {
  if (pattern === WORKSPACE_TOKEN || pattern === `${WORKSPACE_TOKEN}/*`)
    return 'this repository';
  // "*payments*" is how a database or a name the person said is matched.
  const named = /^\*([a-z0-9_-]+)\*$/.exec(pattern);
  return named === null ? pattern : `anything named ${named[1] ?? ''}`;
}

function doingOf(draft: SpokenRuleDraft): string {
  const said = OPERATION_SAID[draft.operation];
  if (said !== undefined) return said;
  if (draft.operation !== ANY_ACTION) return `run ${draft.operation}`;
  const byClass = (draft.classes ?? []).map((each) => CLASS_SAID[each]).find(Boolean);
  if (byClass !== undefined) return byClass;
  return draft.dataClassifications === undefined ? 'touch' : 'send';
}

/** One place it holds, with the word that goes before it. */
function reachSaid(pattern: string): string {
  const said = placeSaid(pattern);
  if (said !== pattern) return said === 'this repository' ? `in ${said}` : said;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(pattern)
    ? `to ${pattern}`
    : `on ${pattern}`;
}

/** Where it reaches, said plainly: what it names, then what it leaves out. */
function whereOf(draft: SpokenRuleDraft): string {
  const targets = draft.targets ?? [];
  const included = targets.filter((each) => !each.startsWith(EXCLUDE) && each !== '*');
  const excluded = [
    ...new Set(
      targets
        .filter((each) => each.startsWith(EXCLUDE))
        .map((each) => placeSaid(each.slice(EXCLUDE.length))),
    ),
  ];
  const branches = draft.branches ?? [];
  const leftOutOfBranches = branches.filter((each) => each.startsWith(EXCLUDE));
  const onBranches = branches.filter((each) => !each.startsWith(EXCLUDE));
  return [
    onBranches.length === 0 ? '' : ` to ${either(onBranches)}`,
    leftOutOfBranches.length === 0
      ? ''
      : `, except to ${either(leftOutOfBranches.map((each) => each.slice(1)))}`,
    included.length === 0 ? '' : ` ${either(included.map(reachSaid))}`,
    excluded.length === 0
      ? ''
      : excluded.includes('this repository')
        ? ' outside this repository'
        : ` anywhere except ${either(excluded)}`,
  ].join('');
}

/** The rule in the words a person checks before they confirm it, and the reason an agent is given. */
export function readBackOfSpokenRule(draft: SpokenRuleDraft): string {
  const who = draft.agent ?? 'agents';
  const data =
    draft.dataClassifications === undefined
      ? ''
      : ` ${either(draft.dataClassifications.map((each) => DATA_SAID[each] ?? each))}`;
  const what = `${doingOf(draft)}${data}${whereOf(draft)}`;
  const instead =
    draft.alternative === undefined ? '' : ` Instead: ${draft.alternative.note}.`;
  if (draft.effect === DECISION_EFFECT.DENY)
    return `${capital(who)} may not ${what}.${instead}`;
  if (draft.effect === DECISION_EFFECT.ALLOW)
    return `${capital(who)} may ${what} without asking.`;
  const asker = draft.agent ?? 'an agent';
  return `A person is asked before ${asker} can ${what}.${instead}`;
}

function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
