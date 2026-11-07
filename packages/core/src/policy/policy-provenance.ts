import type { Policy } from './policy';

/** Where a rule came from: its project, who decided a workspace rule and when, and what a learned one was read from. */
export function provenanceOf(
  raw: Record<string, unknown>,
  path: string,
  issues: string[],
): Pick<Policy, 'project' | 'workspace' | 'decidedBy' | 'decidedAt' | 'learnedFrom'> {
  const text = (field: string): string | undefined => {
    const value = raw[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value !== '') return value;
    issues.push(`${path}.${field} must be a non-empty string when present`);
    return undefined;
  };
  const project = text('project');
  const decidedBy = text('decidedBy');
  const decidedAt = text('decidedAt');
  const learnedFrom = learnedFromOf(raw['learnedFrom'], path, issues);
  return {
    ...(project === undefined ? {} : { project }),
    ...(raw['workspace'] === true ? { workspace: true } : {}),
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(learnedFrom === undefined ? {} : { learnedFrom }),
  };
}

function learnedFromOf(
  value: unknown,
  path: string,
  issues: string[],
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    Array.isArray(value) &&
    value.every((each) => typeof each === 'string' && each !== '')
  )
    return value.length === 0 ? undefined : [...value];
  issues.push(`${path}.learnedFrom must be a list of non-empty strings when present`);
  return undefined;
}
