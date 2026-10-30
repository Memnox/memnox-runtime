import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalOrgSkill,
  readOrgSkills,
  SKILL_FORMATS,
  SKILL_SCOPE,
  type HubSkill,
  type OrgSkill,
  type SkillAssignment,
  type SkillsHub,
} from '@memnox/core';
import type { KeptSkill } from './skill-standing';

/**
 * The organization's skills as the hub hands them out: beside its own, given to the agents each
 * names that are installed here, and never in place of a skill of the same name a person keeps.
 */

/** One organization skill as the writer and the view take it. */
export interface OrgHubSkill {
  org: OrgSkill;
  skill: HubSkill;
  read: KeptSkill;
}

/** The organization's skills this hub does not hold under the same name, each already checked against its digest. */
export async function orgHubSkills(home: string, hub: SkillsHub): Promise<OrgHubSkill[]> {
  const pulled = await readOrgSkills(home);
  const local = new Set(hub.skills.map((skill) => skill.name));
  const at = pulled.updatedAt ?? '';
  return pulled.skills
    .filter((org) => !local.has(org.name))
    .map((org) => ({
      org,
      skill: {
        name: org.name,
        scope: SKILL_SCOPE.ORGANIZATION,
        current: org.version,
        enabled: true,
        accepted: [],
        assignments: orgAssignments(home, org),
        updatedAt: at,
      },
      // Approved in Memnox Cloud and matched to its digest, so it is never held here.
      read: { skill: canonicalOrgSkill(org), digest: org.digest, reaches: [] },
    }));
}

/** Every agent it names, or every agent that takes skills, and only those installed on this machine. */
function orgAssignments(home: string, org: OrgSkill): SkillAssignment[] {
  const named = org.agents;
  return SKILL_FORMATS.filter(
    (format) =>
      (named === undefined || named.includes(format.agent)) &&
      existsSync(join(home, format.installedDir)),
  ).map((format) => ({ agent: format.agent }));
}
