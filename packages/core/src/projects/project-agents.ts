import { DEFAULT_PROFILE_PREFIX, isDefaultProfileId } from '../agents/agent-profile';
import type { ProfileBindings } from '../agents/agent-connection';
import { agentNameIn } from '../discovery/agent';

/**
 * Who a project's `agents` list lets in. An entry is an agent kind, as before, or a profile id: a
 * profile stands for every agent bound to it. An empty list keeps its meaning, every agent seen.
 */

/** The agent kinds a list names, each profile id read as the agents bound to it now. */
export function agentKindsListed(
  listed: readonly string[],
  bindings: ProfileBindings,
): string[] {
  const kinds = listed.flatMap((entry) => {
    if (isDefaultProfileId(entry)) return [entry.slice(DEFAULT_PROFILE_PREFIX.length)];
    const bound = Object.entries(bindings)
      .filter(([, binding]) => binding.profileId === entry)
      .map(([agentId]) => agentNameIn(agentId));
    return bound.length > 0 ? bound : [entry];
  });
  return [...new Set(kinds)];
}

/** Whether a session reaches a project's context: no list is everybody, a list names it or its profile. */
export function projectAdmits(
  listed: readonly string[],
  session: { agentKind: string; profileId: string },
): boolean {
  if (listed.length === 0) return true;
  return listed.includes(session.agentKind) || listed.includes(session.profileId);
}
