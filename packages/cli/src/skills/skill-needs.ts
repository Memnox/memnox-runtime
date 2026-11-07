import { needsOf, type HubSkill, type RuleDraftInput } from '@memnox/core';
import { readKeptSkill } from './skill-standing';

/** What an assigned skill declares it needs, as rules scoped to the one agent it was just given to. */
export async function needsOfAssigned(
  home: string,
  skill: HubSkill,
  agent: string,
): Promise<RuleDraftInput[]> {
  const read = await readKeptSkill(home, skill);
  return read.skill === undefined ? [] : needsOf(read.skill, [agent]);
}
