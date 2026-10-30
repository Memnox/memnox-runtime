import { orgSkillsFrom, readSkillsHub, writeOrgSkills } from '@memnox/core';
import { syncSkills } from '../skills/skills-writer';

/**
 * The organization's skills, carried by the bundle, each checked against the digest Memnox Cloud
 * published before anything is kept, and written into the agents whenever the organization changed them.
 */
export async function keepOrgSkills(
  home: string,
  carried: unknown,
  now: Date,
): Promise<void> {
  // Absent is a bundle publishing none, which takes away any the organization handed out before.
  const changed = await writeOrgSkills(home, orgSkillsFrom(carried ?? []), now);
  if (!changed) return;
  // A folder that will not write must not fail the pull; the next sync from any screen writes it.
  await syncSkills(home, await readSkillsHub(home), now).catch(() => undefined);
}
