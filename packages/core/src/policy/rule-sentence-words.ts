import { TOOL_CLASS } from '../discovery/classify';
import { DATA_CLASSIFICATION } from '../domain/sensitive-data';
import { ANY_ACTION } from './spoken-rule';

/** The words the rule sentence grammar listens for: its verbs, kinds of data, places and names. */

/** A verb as its stems, and the action and class the runtime matches it by. */
export interface Verb {
  stems: readonly string[];
  operation: string;
  classes?: string[];
  /** Whether "to main" after it names a branch. */
  branchy?: boolean;
  /** Whether the words after it are a command to resolve. */
  command?: boolean;
  /** Whether it moves something out, so with nothing named it is a communication. */
  sends?: boolean;
}

const VERBS: readonly Verb[] = [
  { stems: ['force push', 'force-push'], operation: 'git.push-force*', branchy: true },
  { stems: ['push'], operation: 'git.push*', branchy: true },
  { stems: ['merge'], operation: '*merge*', branchy: true },
  { stems: ['deploy', 'ship'], operation: '*deploy*' },
  { stems: ['publish', 'release'], operation: '*publish*' },
  { stems: ['install'], operation: '*install*' },
  {
    stems: ['delete', 'drop', 'remove', 'rm', 'destroy', 'wipe', 'truncate', 'erase'],
    operation: ANY_ACTION,
    classes: [TOOL_CLASS.DESTRUCTIVE],
  },
  {
    stems: [
      'send',
      'upload',
      'post',
      'email',
      'share',
      'export',
      'transfer',
      'copy',
      'sync',
      'leak',
      'exfiltrate',
      'give',
    ],
    operation: ANY_ACTION,
    sends: true,
  },
  {
    stems: ['read', 'open', 'view', 'look at', 'see'],
    operation: ANY_ACTION,
    classes: [TOOL_CLASS.READ],
  },
  {
    stems: ['write', 'edit', 'modify', 'change', 'update', 'overwrite'],
    operation: ANY_ACTION,
    classes: [TOOL_CLASS.WRITE],
  },
  {
    stems: ['touch', 'access', 'use', 'reach', 'query', 'connect to'],
    operation: ANY_ACTION,
  },
  { stems: ['run', 'execute', 'call', 'invoke'], operation: ANY_ACTION, command: true },
];

/** "sends", "sending", "sent", "deleted": the forms a stem is heard in. */
function formsOf(stem: string): string[] {
  const base = stem.endsWith('e') ? stem.slice(0, -1) : stem;
  const irregular: Record<string, string> = {
    send: 'sent',
    run: 'ran',
    see: 'saw',
    give: 'gave',
  };
  return [
    stem,
    `${stem}s`,
    `${stem}es`,
    `${base}ing`,
    `${base}ed`,
    `${stem}d`,
    `${stem}ning`,
  ]
    .concat(irregular[stem] ?? [])
    .concat(
      stem.endsWith('y') ? [`${stem.slice(0, -1)}ies`, `${stem.slice(0, -1)}ied`] : [],
    );
}

/** The verb at this word and how many words it spans, or undefined. */
export function verbAt(
  words: readonly string[],
  index: number,
): { verb: Verb; span: number } | undefined {
  for (const verb of VERBS) {
    for (const stem of verb.stems) {
      const parts = stem.split(' ');
      const head = parts.slice(0, -1);
      const last = parts[parts.length - 1] ?? '';
      const heard = words.slice(index, index + parts.length);
      if (heard.length !== parts.length) continue;
      const leading = head.every((part, at) => heard[at] === part);
      const lastHeard = heard[heard.length - 1] ?? '';
      if (leading && formsOf(last).includes(lastHeard))
        return { verb, span: parts.length };
    }
  }
  return undefined;
}

/** What a payload carries, as the shared classification vocabulary names it. */
export const DATA_WORDS: ReadonlyArray<{ pattern: RegExp; classification: string }> = [
  {
    pattern:
      /\bcustomer(?:s'|'s|s)?\s+(?:records?|data|details|information|info|pii|emails?|lists?|files?)\b/,
    classification: DATA_CLASSIFICATION.CUSTOMER_RECORD,
  },
  {
    pattern:
      /\b(?:personal\s+(?:data|information|info|details)|pii|email addresses|phone numbers|home addresses)\b/,
    classification: DATA_CLASSIFICATION.PERSONAL_DATA,
  },
  {
    pattern:
      /\b(?:secrets?|credentials?|api keys?|access keys?|tokens?|passwords?|private keys?|connection strings?)\b/,
    classification: DATA_CLASSIFICATION.SECRET,
  },
  {
    pattern:
      /\b(?:financial|payment|card numbers?|credit cards?|bank (?:accounts?|details)|invoices?|payroll)\b/,
    classification: DATA_CLASSIFICATION.FINANCIAL,
  },
  {
    pattern: /\b(?:health|medical|patient|diagnos[ie]s|prescriptions?)\b/,
    classification: DATA_CLASSIFICATION.HEALTH,
  },
  {
    pattern:
      /\b(?:government ids?|national ids?|passports?|social security|ssns?|tax ids?)\b/,
    classification: DATA_CLASSIFICATION.GOVERNMENT_ID,
  },
  {
    pattern: /\b(?:confidential|internal only|under nda)\b/,
    classification: DATA_CLASSIFICATION.CONFIDENTIAL,
  },
  { pattern: /\bsource code\b/, classification: DATA_CLASSIFICATION.SOURCE_CODE },
  {
    pattern:
      /\b(?:bulk (?:data|records|exports?)|database dumps?|data dumps?|whole tables?)\b/,
    classification: DATA_CLASSIFICATION.BULK_RECORDS,
  },
  {
    pattern: /\bsensitive (?:data|information|info|material)\b/,
    classification: DATA_CLASSIFICATION.SENSITIVE,
  },
];

/** "to an unapproved destination": approved is said, so the list is the person's to give. */
export const UNAPPROVED =
  /\b(?:to|on)\s+(?:an?\s+|any\s+)?(?:unapproved|unknown|unlisted|outside|external|untrusted|new|other)\s+(?:destinations?|domains?|hosts?|places?|services?|address(?:es)?|servers?|sites?|apis?|endpoints?)\b|\banywhere (?:not approved|we have not approved)\b/;

export const OUTSIDE_REPOSITORY =
  /\boutside\s+(?:of\s+)?(?:this|the|my|our|its|their)\s+(?:repo|repository|project|folder|workspace|directory|checkout)\b/;
export const INSIDE_REPOSITORY =
  /\b(?:in|inside|within)\s+(?:this|the|my|our)\s+(?:repo|repository|project|folder|workspace|directory|checkout)\b/;
export const DATABASE = /\b(?:the\s+)?([a-z0-9_-]+)\s+(?:database|db)\b/;
export const HOST = /\b(?:to|on|at|from)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/;
export const NAMED_ACTION = /^[a-z0-9_-]+\.[a-z0-9_.*-]+$/;
export const BRANCH_NAMES =
  /^(?:main|master|trunk|develop|dev|production|prod|staging|release[a-z0-9_./*-]*)$/;
export const BRANCH =
  /\b(?:to|into|on)\s+(?:the\s+)?([a-z0-9_.\/*-]+)(\s+branch(?:es)?)?\b/;
export const LIST_SEPARATOR = /\s*(?:,|\bor\b|\band\b|\bnor\b)\s*/;

/** Paths a person says by name rather than spelling out. */
export const NAMED_PATHS: ReadonlyArray<{ pattern: RegExp; targets: string[] }> = [
  {
    pattern: /\b(?:\.?env|dotenv) files?\b|(?:^|\s)\.env\b/,
    targets: ['*.env', '*.env.*'],
  },
  { pattern: /\bssh keys?\b|\.ssh\b/, targets: ['*/.ssh/*'] },
];
