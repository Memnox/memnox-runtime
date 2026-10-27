import { DECISION_EFFECT, type DecisionEffect } from '../constants/decision.constants';
import { TOOL_CLASS } from '../discovery/classify';
import { resolveAgentName } from './agent-pause';
import { WORKSPACE_TOKEN } from './pattern-matcher';
import {
  type Verb,
  verbAt,
  DATA_WORDS,
  UNAPPROVED,
  OUTSIDE_REPOSITORY,
  INSIDE_REPOSITORY,
  DATABASE,
  HOST,
  NAMED_ACTION,
  BRANCH_NAMES,
  BRANCH,
  LIST_SEPARATOR,
  NAMED_PATHS,
} from './rule-sentence-words';
import {
  APPROVED_DESTINATIONS_QUESTION,
  EXCLUDE,
  type SpokenRuleDraft,
  type SpokenRuleReading,
} from './spoken-rule';

/**
 * The rules a person says most often, read with no model: an effect (never, ask before, let),
 * who, a verb, what it carries or touches, and what it leaves out. The same sentence always reads
 * the same way; anything else is undefined, so a model drafts it or the person says it again.
 */

/** How a spoken command becomes the action the engine names, handed in so this stays pure. */
export type ActionOf = (command: string) => string;

const WORD_ACTION: ActionOf = (command) => command.trim().split(/\s+/).join('.');

/** Openers in the order tried, so "never let" is a deny before "let" is an allow. */
const OPENERS: ReadonlyArray<{ pattern: RegExp; effect: DecisionEffect }> = [
  { pattern: /^(?:never|do not|don't|dont|no)\s+/, effect: DECISION_EFFECT.DENY },
  {
    pattern:
      /^(?:always\s+)?(?:ask|check with|confirm with)(?:\s+(?:a person|someone|somebody|me|us))?(?:\s+first)?\s+before\s+/,
    effect: DECISION_EFFECT.ASK,
  },
  {
    pattern:
      /^(?:require|need|get)\s+(?:my\s+|an?\s+)?(?:approval|sign off|ok)\s+(?:before|for)\s+/,
    effect: DECISION_EFFECT.ASK,
  },
  { pattern: /^(?:always\s+)?(?:let|allow)\s+/, effect: DECISION_EFFECT.ALLOW },
];

/** "Codex may not ...": the subject first, then what it may or may not do. */
const SUBJECT_FIRST: ReadonlyArray<{ pattern: RegExp; effect: DecisionEffect }> = [
  {
    pattern:
      /^(.+?)\s+(?:may not|must not|mustn't|cannot|can't|can not|should not|shouldn't|should never|must never|may never|is not allowed to|isn't allowed to|are not allowed to|aren't allowed to|never)\s+(.+)$/,
    effect: DECISION_EFFECT.DENY,
  },
  {
    pattern:
      /^(.+?)\s+(?:must|should|has to|have to|needs? to)\s+(?:always\s+)?ask(?:\s+(?:me|a person|someone|us))?(?:\s+first)?\s+before\s+(.+)$/,
    effect: DECISION_EFFECT.ASK,
  },
  {
    pattern: /^(.+?)\s+(?:may|can|is allowed to|are allowed to)\s+(?:always\s+)?(.+)$/,
    effect: DECISION_EFFECT.ALLOW,
  },
];

/** Words that name every agent rather than one. */
const EVERY_AGENT =
  /^(?:(?:an?|any|every|all|the|our|my|no)\s+)?(?:ai\s+)?(?:agents?|ais?|bots?|assistants?|one|anyone|anybody|nobody|it|they)?$/;

/** What a subject trails before its verb: "an agent may", "codex to". */
const SUBJECT_TAIL = /\s+(?:to|may|can|should|must|will|ever|is|are)$/;

/** The sentence lowercased, curly quotes made plain, without its closing stop. */
function normalised(sentence: string): string {
  return sentence
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!\s]+$/, '');
}

interface Opened {
  effect: DecisionEffect;
  /** The subject where the sentence put it first, else undefined and it is read before the verb. */
  subject?: string;
  rest: string;
}

function openerOf(text: string): Opened | undefined {
  for (const opener of OPENERS) {
    const found = opener.pattern.exec(text);
    if (found !== null)
      return { effect: opener.effect, rest: text.slice(found[0].length) };
  }
  for (const form of SUBJECT_FIRST) {
    const found = form.pattern.exec(text);
    if (found !== null)
      return { effect: form.effect, subject: found[1] ?? '', rest: found[2] ?? '' };
  }
  return undefined;
}

/** The agent kind a subject names, undefined for every agent, or a question where it is unclear. */
function agentOf(subject: string): { agent?: string } | { question: string } | null {
  const said = subject
    .replace(/^(?:let|allow)\s+/, '')
    .replace(SUBJECT_TAIL, '')
    .trim();
  if (EVERY_AGENT.test(said)) return {};
  const named = resolveAgentName({ said });
  if ('kind' in named) return { agent: named.kind };
  if ('ambiguous' in named)
    return { question: `Which agent did you mean: ${named.ambiguous.join(' or ')}?` };
  return null;
}

/** Splits off "instead ..." so its words never read as a target. */
function insteadOf(text: string): { body: string; note?: string } {
  const after =
    /,?\s*(?:and\s+)?instead\s*,?\s+(?:it should\s+|have it\s+|tell it to\s+|ask it to\s+)?(.+)$/.exec(
      text,
    );
  if (after !== null && (after[1] ?? '') !== '')
    return { body: text.slice(0, after.index), note: after[1] ?? '' };
  const before = /,\s*(.+?)\s+instead$/.exec(text);
  if (before !== null)
    return { body: text.slice(0, before.index), note: before[1] ?? '' };
  return { body: text };
}

/** Splits off "except ..." and "only ...", the two ways a sentence narrows where it holds. */
function clausesOf(text: string): { body: string; except: string[]; only: string[] } {
  const except = /\b(?:except|other than|unless(?: it is| it's)?|but not)\s+(.+)$/.exec(
    text,
  );
  const head = except === null ? text : text.slice(0, except.index);
  const only = /\bonly\s+(?:to|on|in|into|inside|within|for)?\s*(.+)$/.exec(head);
  const body = only === null ? head : head.slice(0, only.index);
  return { body: body.trim(), except: itemsOf(except?.[1]), only: itemsOf(only?.[1]) };
}

function itemsOf(clause: string | undefined): string[] {
  if (clause === undefined) return [];
  return clause
    .split(LIST_SEPARATOR)
    .map((each) =>
      each
        .replace(/^(?:to|on|in|into|for|the)\s+/, '')
        .replace(/\s+branch(?:es)?$/, '')
        .trim(),
    )
    .filter((each) => each !== '');
}

/** A place one item of an except or only clause names, as a pattern. */
function placeOf(item: string, branchy: boolean): { branch?: string; target?: string } {
  if (branchy && !item.includes('.')) return { branch: item };
  const database = DATABASE.exec(item);
  if (database !== null) return { target: `*${database[1] ?? ''}*` };
  return { target: item };
}

/** What the words after the verb narrow the rule to. */
function narrowing(
  body: string,
  verb: Verb,
): Pick<SpokenRuleDraft, 'targets' | 'dataClassifications' | 'branches'> {
  const targets: string[] = [];
  const branches: string[] = [];
  const dataClassifications = DATA_WORDS.filter((each) => each.pattern.test(body)).map(
    (each) => each.classification,
  );
  if (OUTSIDE_REPOSITORY.test(body))
    targets.push('*', `${EXCLUDE}${WORKSPACE_TOKEN}`, `${EXCLUDE}${WORKSPACE_TOKEN}/*`);
  else if (INSIDE_REPOSITORY.test(body))
    targets.push(WORKSPACE_TOKEN, `${WORKSPACE_TOKEN}/*`);
  for (const named of NAMED_PATHS)
    if (named.pattern.test(body)) targets.push(...named.targets);
  const database = DATABASE.exec(body);
  if (database !== null) targets.push(`*${database[1] ?? ''}*`);
  const branch = verb.branchy === true ? BRANCH.exec(body) : null;
  const branchName = branch?.[1];
  if (
    branchName !== undefined &&
    (BRANCH_NAMES.test(branchName) || branch?.[2] !== undefined)
  )
    branches.push(branchName);
  else {
    const host = HOST.exec(body);
    if (host !== null) targets.push(host[1] ?? '');
  }
  for (const word of body.split(' '))
    if (/^(?:\/|~\/|\.\/)/.test(word) || (word.includes('*') && word.length > 1))
      targets.push(word);
  return {
    ...(targets.length === 0 ? {} : { targets: [...new Set(targets)] }),
    ...(dataClassifications.length === 0 ? {} : { dataClassifications }),
    ...(branches.length === 0 ? {} : { branches }),
  };
}

/** Where a spoken command ends and what it is said to act on begins. */
const COMMAND_ENDS =
  /^(?:on|in|to|against|for|with|from|into|except|unless|outside|inside)$/;
const COMMAND_WORDS = 3;

/** "to staging", "in the tmp folder": a place the sentence names that no narrowing took. */
const PLACE_NAMED =
  /\b(?:to|on|in|into|at|inside|within|under)\s+(?!(?:an?|any|anything|anywhere|it|them)\b)\S+/;

function unread(
  body: string,
  narrowed: Pick<SpokenRuleDraft, 'targets' | 'branches'>,
): boolean {
  return (
    PLACE_NAMED.test(body) &&
    narrowed.targets === undefined &&
    narrowed.branches === undefined &&
    !UNAPPROVED.test(body)
  );
}

/** The operation a command verb names, a named action or the command resolved, and the words it took. */
function commandOf(
  words: readonly string[],
  actionOf: ActionOf,
): { operation: string; used: number } | undefined {
  const [first] = words;
  if (first !== undefined && NAMED_ACTION.test(first))
    return { operation: first, used: 1 };
  const ends = words.findIndex((word) => COMMAND_ENDS.test(word));
  const used = Math.min(ends === -1 ? words.length : ends, COMMAND_WORDS);
  return used === 0
    ? undefined
    : { operation: actionOf(words.slice(0, used).join(' ')), used };
}

/** "except to a and b" applied: a deny leaves them out; an allow or ask lists them. */
function withClauses(
  draft: SpokenRuleDraft,
  clauses: { except: string[]; only: string[] },
  branchy: boolean,
): SpokenRuleDraft | { question: string } {
  const leaveOut = [
    ...clauses.except,
    ...(draft.effect === DECISION_EFFECT.DENY ? clauses.only : []),
  ];
  const keepIn = draft.effect === DECISION_EFFECT.DENY ? [] : clauses.only;
  if (
    [...leaveOut, ...keepIn].some(
      (item) => 'kind' in resolveAgentName({ said: item }) && !item.includes('.'),
    )
  )
    return {
      question:
        'Leaving one agent out is a rule of its own: say it again for the agents it should hold for.',
    };
  const targets = [...(draft.targets ?? [])];
  const branches = [...(draft.branches ?? [])];
  for (const item of keepIn) {
    const place = placeOf(item, branchy);
    if (place.branch !== undefined) branches.push(place.branch);
    if (place.target !== undefined) targets.push(place.target);
  }
  for (const item of leaveOut) {
    const place = placeOf(item, branchy);
    if (place.branch !== undefined) branches.push(`${EXCLUDE}${place.branch}`);
    if (place.target !== undefined) {
      if (!targets.includes('*') && !targets.some((each) => !each.startsWith(EXCLUDE)))
        targets.push('*');
      targets.push(`${EXCLUDE}${place.target}`);
    }
  }
  return {
    ...draft,
    ...(targets.length === 0 ? {} : { targets: [...new Set(targets)] }),
    ...(branches.length === 0 ? {} : { branches: [...new Set(branches)] }),
  };
}

/**
 * The rule a sentence states, or undefined where it opens on no effect, names nothing an agent
 * does, or names an agent nobody here runs. Never a model, so it needs no account and no network.
 */
export function readRuleSentence(
  sentence: string,
  actionOf: ActionOf = WORD_ACTION,
): SpokenRuleReading | undefined {
  const parts = partsOf(normalised(sentence));
  if (parts === undefined) return undefined;
  const { verb, who, after } = parts;
  const command = verb.command === true ? commandOf(after, actionOf) : undefined;
  if (verb.command === true && command === undefined) return undefined;
  const clauses = clausesOf(after.slice(command?.used ?? 0).join(' '));
  const narrowed = narrowing(clauses.body, verb);
  // A place it named and nothing here understood would be dropped, and a rule wider than was said is worse than none.
  if (unread(clauses.body, narrowed)) return undefined;
  const sends =
    verb.sends === true &&
    narrowed.dataClassifications === undefined &&
    narrowed.targets === undefined;
  const classes = verb.classes ?? (sends ? [TOOL_CLASS.COMMUNICATION] : undefined);
  const base: SpokenRuleDraft = {
    effect: parts.effect,
    operation: command?.operation ?? verb.operation,
    ...('agent' in who && who.agent !== undefined ? { agent: who.agent } : {}),
    ...narrowed,
    ...(classes === undefined ? {} : { classes: [...classes] }),
    ...(parts.note === undefined ? {} : { alternative: alternativeOf(parts.note) }),
  };
  const draft = withClauses(base, clauses, verb.branchy === true);
  if ('question' in draft) return { draft: base, openQuestions: [draft.question] };
  const unnamed =
    UNAPPROVED.test(clauses.body) &&
    clauses.except.length === 0 &&
    clauses.only.length === 0;
  const openQuestions = [
    ...('question' in who ? [who.question] : []),
    ...(unnamed ? [APPROVED_DESTINATIONS_QUESTION] : []),
  ];
  return { draft, openQuestions };
}

/** What a sentence is made of before what it narrows to: the effect, who, the verb, and what follows. */
interface SentenceParts {
  effect: DecisionEffect;
  who: { agent?: string } | { question: string };
  verb: Verb;
  after: string[];
  note?: string;
}

function partsOf(text: string): SentenceParts | undefined {
  const opened = openerOf(text);
  if (opened === undefined) return undefined;
  const { body, note } = insteadOf(opened.rest);
  const words = body.split(' ');
  const at =
    opened.subject === undefined
      ? words.findIndex((_word, index) => verbAt(words, index) !== undefined)
      : 0;
  const found = at === -1 ? undefined : verbAt(words, at);
  if (found === undefined) return undefined;
  const who = agentOf(opened.subject ?? words.slice(0, at).join(' '));
  if (who === null) return undefined;
  return {
    effect: opened.effect,
    who,
    verb: found.verb,
    after: words.slice(at + found.span),
    ...(note === undefined ? {} : { note }),
  };
}

/** What a refused agent is told instead: the action it names where it names one, and the words. */
function alternativeOf(note: string): { action: string; note: string } {
  const named = note.split(' ').find((word) => NAMED_ACTION.test(word));
  return { action: named ?? note, note };
}

/** The destinations a person named as approved, left out of the rule, which answers that question. */
export function withApprovedDestinations(
  reading: SpokenRuleReading,
  approved: readonly string[],
): SpokenRuleReading {
  const named = approved
    .map((each) => each.trim().toLowerCase())
    .filter((each) => each !== '');
  if (named.length === 0) return reading;
  const kept = (reading.draft.targets ?? []).filter((each) => each !== '*');
  const targets = [
    ...new Set(['*', ...kept, ...named.map((each) => `${EXCLUDE}${each}`)]),
  ];
  return {
    draft: { ...reading.draft, targets },
    openQuestions: reading.openQuestions.filter(
      (each) => each !== APPROVED_DESTINATIONS_QUESTION,
    ),
  };
}
