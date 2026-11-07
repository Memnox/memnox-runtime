/** The field readers a rule file's validator shares: each says what was wrong, by path. */

export function asRecord(
  input: unknown,
  path: string,
  issues: string[],
): Record<string, unknown> | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  issues.push(`${path} must be an object`);
  return null;
}

export function asNonEmptyString(
  input: unknown,
  path: string,
  issues: string[],
): string | null {
  if (typeof input === 'string' && input.trim().length > 0) return input.trim();
  issues.push(`${path} must be a non-empty string`);
  return null;
}

export function asStringArray(
  input: unknown,
  path: string,
  issues: string[],
): string[] | null {
  if (Array.isArray(input) && input.every((item) => typeof item === 'string')) {
    return input as string[];
  }
  issues.push(`${path} must be a string array`);
  return null;
}

export function asOptionalStringArray(
  input: unknown,
  path: string,
  issues: string[],
): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  return asStringArray(input, path, issues) ?? undefined;
}
