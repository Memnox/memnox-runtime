import { currentBranch } from './work-refs';
import { runGit } from './git-region';

/**
 * What a checkout claims: an issue number at the head of its branch and keys its head commit names.
 * The workspace checks each against what its trackers delivered; only the claim leaves the machine.
 */

export const WORK_CLAIM_FORM = { KEY: 'key', NUMBER: 'number', URL: 'url' } as const;
export const WORK_CLAIM_SOURCE = {
  BRANCH: 'branch',
  COMMIT: 'commit',
  PROMPT: 'prompt',
} as const;

export interface WorkClaim {
  value: string;
  form: (typeof WORK_CLAIM_FORM)[keyof typeof WORK_CLAIM_FORM];
  source: (typeof WORK_CLAIM_SOURCE)[keyof typeof WORK_CLAIM_SOURCE];
  /** The commit a commit claim was read from, so the evidence stays the commit. */
  evidence?: string;
}

export interface WorkClaims {
  /** The branch the checkout is on, so a change of branch can replace what the old one claimed. */
  branch?: string;
  claims: WorkClaim[];
}

/** How long reading the head commit may take before the lease goes without it. */
export const COMMIT_READ_TIMEOUT_MS = 400;
/** More keys than this in one message reads as a list, not as the work. */
const MOST_COMMIT_KEYS = 3;
/** `12-fix-login`, `issue-12`, `gh-12`: how a forge names a branch made from an issue. */
const NUMBERED_BRANCH = /^(?:(?:issue|issues|gh)-)?(\d{1,5})-[a-z]/i;
const ISSUE_PREFIXED_BRANCH = /^(?:issue|issues|gh)-(\d{1,5})$/i;
/** A four digit lead from 1900 to 2099 is a year in a branch name far more often than an issue. */
const YEAR = /^(19|20)\d{2}$/;
const KEY_IN_TEXT =
  /(?:^|[^A-Za-z0-9-])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?=$|[^A-Za-z0-9-])/g;
/** Prefixes that look like a key and name a standard, a version or an encoding instead. */
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
const COMMIT_FORMAT = '--format=%H%x00%B';
const NUL = '\u0000';

/** The issue number a branch was made for, read from its last segment, or undefined. */
export function numberClaimOfBranch(branch: string | null): WorkClaim | undefined {
  if (branch === null) return undefined;
  const last = branch.split('/').at(-1) ?? branch;
  const match = NUMBERED_BRANCH.exec(last) ?? ISSUE_PREFIXED_BRANCH.exec(last);
  const digits = match === null ? undefined : match[1];
  if (digits === undefined || YEAR.test(digits) || Number(digits) === 0) return undefined;
  return {
    value: `#${String(Number(digits))}`,
    form: WORK_CLAIM_FORM.NUMBER,
    source: WORK_CLAIM_SOURCE.BRANCH,
  };
}

/**
 * The keys a commit message names, written in capitals as a tracker writes
 * them. More than a handful reads as a list rather than the work, so none.
 */
export function keysInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(KEY_IN_TEXT)) {
    const [, prefix, number] = match;
    if (prefix === undefined || number === undefined) continue;
    if (NOT_KEY_PREFIXES.includes(prefix)) continue;
    found.add(`${prefix}-${number}`);
  }
  return found.size > MOST_COMMIT_KEYS ? [] : [...found];
}

/** Keys in the head commit's message, each carrying the commit it came from. */
export async function commitClaimsAt(
  root: string,
  timeoutMs: number = COMMIT_READ_TIMEOUT_MS,
): Promise<WorkClaim[]> {
  const out = await runGit(['log', '-1', COMMIT_FORMAT], root, timeoutMs);
  if (out === null) return [];
  const at = out.indexOf(NUL);
  if (at < 0) return [];
  const sha = out.slice(0, at).trim();
  return keysInText(out.slice(at + 1)).map((value) => ({
    value,
    form: WORK_CLAIM_FORM.KEY,
    source: WORK_CLAIM_SOURCE.COMMIT,
    ...(sha === '' ? {} : { evidence: sha }),
  }));
}

/** What this checkout claims now, and what its session's prompts named. Branch keys travel as its refs. */
export async function workClaimsAt(
  root: string,
  prompted: () => Promise<readonly WorkClaim[]> = async () => [],
): Promise<WorkClaims> {
  const branch = await currentBranch(root);
  const number = numberClaimOfBranch(branch);
  const commits = await commitClaimsAt(root);
  const fromPrompts = await prompted().catch(() => []);
  return {
    ...(branch === null ? {} : { branch }),
    claims: [...(number === undefined ? [] : [number]), ...commits, ...fromPrompts],
  };
}
