import {
  PROPOSAL_ANSWER,
  readSkillsHub,
  skillNamed,
  type SkillsChange,
} from '@memnox/core';
import { proposeRuleDraft } from '../studio/rule-changes';
import { applySkillsChange } from '../skills/skills-changes';
import { needsOfAssigned } from '../skills/skill-needs';

/**
 * A signed Skills Hub proposal carried out: the hub changed and every agent's folder written to
 * match. A skill given to an agent also raises its declared needs as rules for that agent to sign.
 */
export async function applySkillsProposal(
  home: string,
  change: SkillsChange,
  now: Date,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
  const changed = await applySkillsChange(home, change, now);
  if ('refused' in changed) return { ok: false, error: changed.refused };
  const files = 'synced' in changed ? changed.synced.summary.files.length : 0;
  const written = `written to ${files} place${files === 1 ? '' : 's'}`;
  if (!('assign' in change))
    return { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${written}` };
  const skill = skillNamed(await readSkillsHub(home), change.assign.name);
  const needs =
    skill === undefined ? [] : await needsOfAssigned(home, skill, change.assign.agent);
  let proposed = 0;
  for (const need of needs) {
    const raised = await proposeRuleDraft(home, need, now.toISOString());
    if ('proposed' in raised) proposed += 1;
  }
  const rules =
    proposed === 0
      ? ''
      : `, and ${proposed} rule${proposed === 1 ? '' : 's'} it needs proposed`;
  return { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${written}${rules}` };
}
