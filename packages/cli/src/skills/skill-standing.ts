import {
  readCanonicalSkill,
  reachesOf,
  SKILL_STANDING,
  skillDirFor,
  skillStandingOf,
  verbTableNames,
  type CanonicalSkill,
  type HubSkill,
  type SkillHold,
} from '@memnox/core';

/**
 * A kept skill's folder read as it is now and held against the version somebody accepted. Held is
 * what keeps a changed skill from reaching any agent until a person looks at it again.
 */

export interface KeptSkill {
  /** Absent when the folder would not read, which holds it as surely as a change. */
  skill?: CanonicalSkill;
  digest: string;
  held?: SkillHold;
  problems?: string[];
  /** Command line tools its text names. */
  reaches: string[];
}

function canonicalDirOf(home: string, skill: HubSkill): string {
  return skillDirFor(home, {
    name: skill.name,
    scope: skill.scope,
    version: skill.current,
    ...(skill.project === undefined ? {} : { project: skill.project }),
  });
}

export async function readKeptSkill(home: string, skill: HubSkill): Promise<KeptSkill> {
  const read = await readCanonicalSkill(canonicalDirOf(home, skill));
  if ('problems' in read) return { digest: '', problems: read.problems, reaches: [] };
  const reaches = reachesOf(read.skill, verbTableNames());
  const now = skillStandingOf(skill, {
    digest: read.digest,
    tools: read.skill.manifest.tools,
    reaches,
  });
  const held: SkillHold | undefined =
    now.standing === SKILL_STANDING.KNOWN
      ? undefined
      : { standing: now.standing, gained: now.gained, signed: now.widened };
  return {
    skill: read.skill,
    digest: read.digest,
    reaches,
    ...(held === undefined ? {} : { held }),
  };
}
