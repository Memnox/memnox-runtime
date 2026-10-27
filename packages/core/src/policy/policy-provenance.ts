import type { Policy } from './policy';

/** Where a rule came from: its project, and for a workspace rule who decided it and when. */
export function provenanceOf(
  raw: Record<string, unknown>,
  path: string,
  issues: string[],
): Pick<Policy, 'project' | 'workspace' | 'decidedBy' | 'decidedAt'> {
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
  return {
    ...(project === undefined ? {} : { project }),
    ...(raw['workspace'] === true ? { workspace: true } : {}),
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
  };
}
