import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  filesLost,
  withHeader,
  type FormatPlace,
  type SkillFormat,
  type Translation,
} from './translation';

/** Copilot reads a skill as a custom agent, one file, which keeps its tool list. */
export const COPILOT_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.COPILOT_CLI,
  label: 'GitHub Copilot',
  installedDir: '.copilot',
  translate: copilotAgent,
};

function copilotAgent(skill: CanonicalSkill, place: FormatPlace): Translation {
  const { name, description, tools } = skill.manifest;
  const dir = place.project ? '.github/agents' : '.copilot/agents';
  return {
    file: {
      path: `${dir}/${name}.md`,
      content: withHeader(
        { name, description, tools: tools.length === 0 ? undefined : tools },
        skill.instructions,
      ),
    },
    loses: filesLost(skill, 'A Copilot agent'),
  };
}
