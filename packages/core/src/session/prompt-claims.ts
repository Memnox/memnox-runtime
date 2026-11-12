import {
  WORK_CLAIM_FORM,
  WORK_CLAIM_SOURCE,
  type WorkClaim,
} from '../coordination/work-claims';
import { SessionTasks } from './session-task';

/**
 * The one issue a person's own words name as the task, read on this machine and never sent: only the claim leaves.
 * Strict on purpose: the prompt is the reference alone, or opens by asking for it, and anything else names nothing.
 */

/** Off until reviewed: set to `1` to let a prompt's own reference become a claim. */
export const PROMPT_CLAIMS_ENV = 'MEMNOX_PROMPT_CLAIMS';
/** More lines than this is material pasted in, not an ask. */
const MOST_PROMPT_LINES = 8;
const FENCED = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]*`/g;
const QUOTED = /"[^"]*"|“[^”]*”|'[^'\n]*'/g;
const QUOTE_LINE = /^\s*>/;
const LOG_LINE = /^\s*(at\s+\S+\s*\(|\w*(Error|Exception):|Traceback|\s*File ")/;
const VERBS =
  '(?:fix|implement|work on|finish|review|continue|continue with|start|start on|resolve|handle|pick up|take|do|look at)';
const LEADING = '(?:issue|ticket|task|the issue|the ticket)?';
const KEY = '[A-Za-z][A-Za-z0-9]{1,9}-\\d{1,7}';
const NUMBER = '#\\d{1,9}';
const LINK = 'https://\\S+';
const REFERENCE = `(${KEY}|${NUMBER}|${LINK})`;
const ALONE = new RegExp(`^${REFERENCE}[.!]?$`, 'i');
const ASKED = new RegExp(
  `^(?:please\\s+)?${VERBS}\\s+${LEADING}\\s*${REFERENCE}(?=$|[\\s:,.!])`,
  'i',
);
const ANY_REFERENCE = new RegExp(
  `(?:^|[^A-Za-z0-9-])(${KEY}|${NUMBER})(?=$|[^A-Za-z0-9-])|${LINK}`,
  'gi',
);
const TRACKER_LINK =
  /^https:\/\/(linear\.app\/[^/]+\/issue\/|[^/]+\.atlassian\.net\/browse\/|github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d|gitlab\.com\/.+\/-\/(issues|merge_requests)\/\d|trello\.com\/c\/)/i;
const NOT_KEY_PREFIXES: readonly string[] = [
  'UTF',
  'SHA',
  'ISO',
  'RFC',
  'CVE',
  'ES',
  'GPT',
  'TLS',
  'IPV',
  'HTTP',
  'MD',
  'AES',
  'RSA',
  'PEP',
  'ECMA',
];

export function promptClaimsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PROMPT_CLAIMS_ENV] === '1';
}

/** The person's words with code, quotes, pasted logs and quoted replies taken out. */
function ownWords(prompt: string): string | undefined {
  const lines = prompt
    .replace(FENCED, ' ')
    .replace(INLINE_CODE, ' ')
    .split('\n')
    .filter((line) => !QUOTE_LINE.test(line) && !LOG_LINE.test(line));
  if (lines.filter((line) => line.trim() !== '').length > MOST_PROMPT_LINES)
    return undefined;
  return lines.join(' ').replace(QUOTED, ' ').replace(/\s+/g, ' ').trim();
}

/** At most one claim, and only where doubt is impossible; any second candidate means none. */
export function promptClaims(prompt: string): WorkClaim[] {
  const words = ownWords(prompt);
  if (words === undefined || words === '') return [];
  const candidates = [...words.matchAll(ANY_REFERENCE)];
  if (candidates.length !== 1) return [];
  const asked = ALONE.exec(words) ?? ASKED.exec(words);
  const reference = asked === null ? undefined : asked[1];
  if (reference === undefined) return [];
  const claim = claimOf(reference);
  return claim === undefined ? [] : [claim];
}

function claimOf(reference: string): WorkClaim | undefined {
  if (reference.toLowerCase().startsWith('https://')) {
    return TRACKER_LINK.test(reference)
      ? { value: reference, form: WORK_CLAIM_FORM.URL, source: WORK_CLAIM_SOURCE.PROMPT }
      : undefined;
  }
  if (reference.startsWith('#')) {
    return {
      value: `#${String(Number(reference.slice(1)))}`,
      form: WORK_CLAIM_FORM.NUMBER,
      source: WORK_CLAIM_SOURCE.PROMPT,
    };
  }
  const key = reference.toUpperCase();
  const prefix = key.split('-')[0] ?? '';
  if (NOT_KEY_PREFIXES.includes(prefix)) return undefined;
  return { value: key, form: WORK_CLAIM_FORM.KEY, source: WORK_CLAIM_SOURCE.PROMPT };
}

/** Most prompt claims one session keeps, newest kept, since a person may move on to the next issue. */
const MOST_KEPT = 3;

/** This session's prompt claims added to what it already kept, each once, newest last. */
export function withPromptClaims(
  kept: readonly WorkClaim[] | undefined,
  found: readonly WorkClaim[],
): WorkClaim[] {
  const all = [...(kept ?? []), ...found];
  const once = all.filter(
    (claim, at) =>
      all.findIndex((each) => each.value === claim.value && each.form === claim.form) ===
      at,
  );
  return once.slice(-MOST_KEPT);
}

/** What this session's prompts named, read off its own task on this machine. */
export async function promptedIn(home: string, sessionId: string): Promise<WorkClaim[]> {
  if (sessionId === '' || !promptClaimsEnabled()) return [];
  const task = await new SessionTasks(home).read(sessionId);
  return task === null || task.promptClaims === undefined ? [] : task.promptClaims;
}
