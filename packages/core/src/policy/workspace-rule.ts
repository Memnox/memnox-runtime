import { readJsonFile } from '../store/json-records';
import { orgPolicyPathFor } from './org-bundle';

/** A rule the workspace published, as `why` names it: who decided it, when, and in which bundle. */
export interface WorkspaceRule {
  decidedBy?: string;
  decidedAt?: string;
  /** The bundle this machine runs now, set beside the one the event was decided under. */
  bundleHash?: string;
}

interface OrgDocument {
  bundleHash?: string;
  policies?: {
    name?: string;
    workspace?: boolean;
    decidedBy?: string;
    decidedAt?: string;
  }[];
}

/** The workspace's rule by the name a row cites, or null for a rule this machine wrote itself. */
export async function workspaceRuleOf(
  home: string,
  name: string,
): Promise<WorkspaceRule | null> {
  const document = await readJsonFile<OrgDocument>(orgPolicyPathFor(home));
  const rule = document?.policies?.find((each) => each.name === name);
  if (rule === undefined) return null;
  return {
    ...(rule.decidedBy === undefined ? {} : { decidedBy: rule.decidedBy }),
    ...(rule.decidedAt === undefined ? {} : { decidedAt: rule.decidedAt }),
    ...(document?.bundleHash === undefined ? {} : { bundleHash: document.bundleHash }),
  };
}

/** Whether the workspace has published newer rules than the bundle the event was decided under. */
export function publishedSince(rule: WorkspaceRule, decidedUnder?: string): boolean {
  return (
    decidedUnder !== undefined &&
    rule.bundleHash !== undefined &&
    decidedUnder !== rule.bundleHash
  );
}

/** Who decided it and when, said plainly, and whether the team has published newer rules since. */
export function decidedLine(rule: WorkspaceRule, decidedUnder?: string): string {
  const who = rule.decidedBy ?? 'the workspace';
  const when = rule.decidedAt === undefined ? '' : ` on ${rule.decidedAt.slice(0, 10)}`;
  const since = publishedSince(rule, decidedUnder)
    ? ', and the workspace has published newer rules since'
    : '';
  return `${who}${when}${since}`;
}
