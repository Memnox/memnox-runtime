/** A policy file's own sensitive data patterns, checked before any of them runs on a call. */
import {
  compilePattern,
  MOST_PATTERN_CHARS,
  type DataPattern,
} from '../domain/sensitive-data';

/** A name a rule's `dataClassifications` can match, as `codename` or `confidential`. */
const CLASSIFICATION_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** A team's own patterns, each under the classification it adds; every bad one is listed. */
export function validateClassifications(
  input: unknown,
  issues: string[],
): { classifications?: DataPattern[] } {
  if (input === undefined || input === null) return {};
  if (!Array.isArray(input)) {
    issues.push('"classifications" must be an array');
    return {};
  }
  const valid: DataPattern[] = [];
  for (const [index, raw] of input.entries()) {
    const path = `classifications[${index}]`;
    const entry = asRecord(raw, path, issues);
    if (!entry) continue;
    const name = entry['classification'];
    if (typeof name !== 'string' || !CLASSIFICATION_NAME.test(name)) {
      issues.push(
        `${path}.classification must be a lowercase name such as "confidential"`,
      );
      continue;
    }
    const patterns = asStringArray(entry['patterns'], `${path}.patterns`, issues);
    if (patterns === null) continue;
    const broken = patterns.filter((pattern) => compilePattern(pattern) === null);
    for (const pattern of broken) {
      issues.push(
        `${path}.patterns: "${pattern}" is empty, longer than ${MOST_PATTERN_CHARS} characters, or not a regex`,
      );
    }
    if (broken.length === 0) valid.push({ classification: name, patterns });
  }
  return valid.length === 0 ? {} : { classifications: valid };
}

function asRecord(
  input: unknown,
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return Object.fromEntries(Object.entries(input));
  }
  issues.push(`${path} must be a table`);
  return null;
}

function asStringArray(input: unknown, path: string, issues: string[]): string[] | null {
  if (
    Array.isArray(input) &&
    input.length > 0 &&
    input.every((each) => typeof each === 'string')
  ) {
    return input.filter((each): each is string => typeof each === 'string');
  }
  issues.push(`${path} must be a list of text`);
  return null;
}
