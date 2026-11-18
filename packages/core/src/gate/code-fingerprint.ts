import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

import { ACTION } from '../constants/action.constants';
import { DECISION_EFFECT } from '../constants/decision.constants';
import type { Policy } from '../policy/index';

/**
 * How a repository writes code, as its team states it. `enforce` entries are refused at
 * the write; the rest is guidance told at session start, since judgment is not a pattern.
 */
// Spelled with `/` everywhere, since it is a path in the repository that agents are told and join still reads.
export const CODE_FINGERPRINT_FILE = '.memnox/code-fingerprint.yaml';

/** One convention checked on every line a write adds to the files it names. */
export interface FingerprintCheck {
  name: string;
  /** Relative to the repository root, `!` taking a file back out. */
  files: string[];
  /** Wildcard patterns no added line may match. */
  forbid: string[];
  reason: string;
  /** What to write instead, which the refusal hands the agent. */
  instead?: string;
}

export interface CodeFingerprint {
  checks: FingerprintCheck[];
  /** Everything outside `enforce`, one line per stated preference. */
  guidance: string[];
  /** What could not be read, each said out loud rather than dropped in silence. */
  issues: string[];
}

/** The key whose entries are enforced; every other key is guidance. */
const ENFORCE_KEY = 'enforce';

/** Lines of guidance one session is told, so a long file cannot fill a context window. */
export const MOST_GUIDANCE_LINES = 60;

/** Characters of one guidance line. */
const MOST_GUIDANCE_LENGTH = 200;

const EXCLUDE = '!';

/** Null where the repository states no fingerprint, which is the ordinary case. */
export async function readCodeFingerprint(root: string): Promise<CodeFingerprint | null> {
  let raw: string;
  try {
    raw = await readFile(join(root, CODE_FINGERPRINT_FILE), 'utf8');
  } catch {
    // No file is no fingerprint, which is an answer rather than a failure.
    return null;
  }
  return parseCodeFingerprint(raw);
}

export function parseCodeFingerprint(raw: string): CodeFingerprint {
  let document: unknown;
  try {
    document = parse(raw);
  } catch (err) {
    return { checks: [], guidance: [], issues: [`it is not YAML: ${String(err)}`] };
  }
  if (!isRecord(document)) {
    return { checks: [], guidance: [], issues: ['it is not a mapping of sections'] };
  }
  const issues: string[] = [];
  const enforce = document[ENFORCE_KEY];
  const checks = enforce === undefined ? [] : checksOf(enforce, issues);
  const stated = Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== ENFORCE_KEY),
  );
  const every = linesOf(stated, []);
  // Said, since guidance cut in silence reads as guidance the repository never stated.
  if (every.length > MOST_GUIDANCE_LINES) {
    issues.push(
      `${every.length - MOST_GUIDANCE_LINES} guidance line(s) past the first ${MOST_GUIDANCE_LINES} are not read`,
    );
  }
  const guidance = every
    .slice(0, MOST_GUIDANCE_LINES)
    .map((line) => line.slice(0, MOST_GUIDANCE_LENGTH));
  return { checks, guidance, issues };
}

/**
 * Each check as a rule the gate already enforces: a write to its files adding a line it
 * forbids is refused, with the reason and the way forward.
 */
export function fingerprintPolicies(
  fingerprint: CodeFingerprint,
  root: string,
): Policy[] {
  return fingerprint.checks.map((check) => ({
    name: `fingerprint:${check.name}`,
    match: {
      actions: [ACTION.FILESYSTEM_WRITE],
      targets: check.files.map((pattern) => underRoot(pattern, root)),
      content: check.forbid,
    },
    decision: {
      effect: DECISION_EFFECT.DENY,
      reason: `This repository's code fingerprint: ${check.reason}`,
      ...(check.instead === undefined
        ? {}
        : { alternative: { action: ACTION.FILESYSTEM_WRITE, note: check.instead } }),
    },
  }));
}

/** What an agent is told at the start of a session, or null where nothing is stated. */
export function describeFingerprint(fingerprint: CodeFingerprint): string | null {
  const enforced = fingerprint.checks.map(
    (check) => `enforced: ${check.reason} (${check.files.join(', ')})`,
  );
  // Every check, however long the guidance: one the agent is never told still refuses it.
  const lines = [...fingerprint.guidance, ...enforced];
  if (lines.length === 0) return null;
  return [
    `This repository states how its code is written, in ${CODE_FINGERPRINT_FILE}. Follow it; a write that breaks an enforced line is refused.`,
    ...lines.map((line) => `- ${line}`),
  ].join('\n');
}

// Absolute, because a write is ruled on by its absolute path.
function underRoot(pattern: string, root: string): string {
  const excluded = pattern.startsWith(EXCLUDE);
  const bare = excluded ? pattern.slice(EXCLUDE.length) : pattern;
  const path = `${root.replace(/\/+$/, '')}/${bare.replace(/^\.?\/+/, '')}`;
  return excluded ? `${EXCLUDE}${path}` : path;
}

function checksOf(value: unknown, issues: string[]): FingerprintCheck[] {
  if (!Array.isArray(value)) {
    issues.push(`${ENFORCE_KEY} must be a list of checks`);
    return [];
  }
  const checks: FingerprintCheck[] = [];
  for (const [index, entry] of value.entries()) {
    const check = checkOf(entry, `${ENFORCE_KEY}[${index}]`, issues);
    if (check !== null) checks.push(check);
  }
  return checks;
}

/**
 * One check, or null with the reason: skipped rather than failing the file, since one bad
 * entry must not stop every agent, and said, since a skipped check enforces nothing.
 */
function checkOf(
  entry: unknown,
  path: string,
  issues: string[],
): FingerprintCheck | null {
  if (!isRecord(entry)) {
    issues.push(`${path} is not a mapping`);
    return null;
  }
  const name = text(entry['name']);
  const reason = text(entry['reason']);
  const files = strings(entry['files']);
  const forbid = strings(entry['forbid']);
  const instead = text(entry['instead']);
  const missing = [
    ...(name === null ? ['name'] : []),
    ...(reason === null ? ['reason'] : []),
    // Empty would read as every file or every line, which is a wall rather than a convention.
    ...(files === null ? ['files'] : []),
    ...(forbid === null ? ['forbid'] : []),
  ];
  if (name === null || reason === null || files === null || forbid === null) {
    issues.push(`${path} is skipped: ${missing.join(', ')} missing or empty`);
    return null;
  }
  return { name, files, forbid, reason, ...(instead === null ? {} : { instead }) };
}

/** Every stated preference as `section.key: value`, lists joined, in the file's order. */
function linesOf(value: unknown, path: readonly string[]): string[] {
  const label = path.join('.');
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return [`${label}: ${String(value)}`];
  }
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string | number =>
        typeof item === 'string' || typeof item === 'number',
    );
    return items.length === 0 ? [] : [`${label}: ${items.join('; ')}`];
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, inner]) =>
      linesOf(inner, [...path, key]),
    );
  }
  return [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A non-empty list of non-empty strings, or null. */
function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const found = value.filter(
    (each): each is string => typeof each === 'string' && each !== '',
  );
  return found.length === value.length ? found : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
