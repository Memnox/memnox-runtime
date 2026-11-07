import { join } from 'node:path';
import {
  MEMNOX_HOME,
  needsOf,
  readJsonFile,
  writeJsonFile,
  type CanonicalSkill,
} from '@memnox/core';
import { proposeRuleDraft } from '../studio/rule-changes';

/**
 * An organization skill written into an agent here raises what it declares it needs as rules for
 * that agent, each a proposal the person signs, exactly as a personal skill given to one does.
 * Each version is proposed once per agent, so a sync that writes nothing new raises nothing.
 */

const NEEDS_FILE = 'org-skill-needs.json';

/** One organization skill as it was just written, and the agents it was written into. */
export interface OrgSkillWritten {
  name: string;
  digest: string;
  skill: CanonicalSkill;
  agents: readonly string[];
}

/** A version whose needs were already proposed for one agent. */
interface Raised {
  skill: string;
  digest: string;
  agent: string;
}

function pathFor(home: string): string {
  return join(home, MEMNOX_HOME, NEEDS_FILE);
}

/** The proposals raised, by id; a skill the organization no longer hands out is forgotten here too. */
export async function proposeOrgSkillNeeds(
  home: string,
  written: readonly OrgSkillWritten[],
  now: Date,
): Promise<string[]> {
  const before = (await readJsonFile<Raised[]>(pathFor(home))) ?? [];
  const current = before.filter((each) =>
    written.some((org) => org.name === each.skill && org.digest === each.digest),
  );
  const proposed: string[] = [];
  for (const org of written) {
    const fresh = org.agents.filter(
      (agent) =>
        !current.some(
          (each) =>
            each.skill === org.name && each.digest === org.digest && each.agent === agent,
        ),
    );
    if (fresh.length === 0) continue;
    for (const need of needsOf(org.skill, fresh)) {
      const raised = await proposeRuleDraft(home, need, now.toISOString());
      if ('proposed' in raised) proposed.push(raised.proposed);
    }
    current.push(
      ...fresh.map((agent) => ({ skill: org.name, digest: org.digest, agent })),
    );
  }
  if (proposed.length > 0 || current.length !== before.length)
    await writeJsonFile(pathFor(home), current);
  return proposed;
}
