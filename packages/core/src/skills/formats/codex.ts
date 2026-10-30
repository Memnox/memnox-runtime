import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  skillFolder,
  toolsLost,
  withHeader,
  type SkillFormat,
  type Translation,
} from './translation';

/** Codex reads a skill folder with a name and a description, and no tool grant. */
export const CODEX_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.CODEX_CLI,
  label: 'Codex',
  installedDir: '.codex',
  translate: codexSkill,
};

function codexSkill(skill: CanonicalSkill): Translation {
  const { name, description } = skill.manifest;
  const instructions = withHeader({ name, description }, skill.instructions);
  return {
    folder: skillFolder(`.codex/skills/${name}`, skill, instructions),
    loses: toolsLost(skill, 'Codex'),
  };
}
