import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  filesLost,
  skillFolder,
  toolsLost,
  withHeader,
  type FormatPlace,
  type SkillFormat,
  type Translation,
} from './translation';

/**
 * Cursor reads a skill folder where its skills folder is already in use, and otherwise a rule:
 * one `.mdc` file it applies when the description fits, which carries only the instructions.
 */
export const CURSOR_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.CURSOR,
  label: 'Cursor',
  installedDir: '.cursor',
  translate: cursorSkill,
};

function cursorSkill(skill: CanonicalSkill, place: FormatPlace): Translation {
  const { name, description } = skill.manifest;
  const loses = toolsLost(skill, 'Cursor');
  if (place.hasSkillsFolder) {
    const instructions = withHeader({ name, description }, skill.instructions);
    return { folder: skillFolder(`.cursor/skills/${name}`, skill, instructions), loses };
  }
  return {
    file: {
      path: `.cursor/rules/${name}.mdc`,
      content: withHeader({ description, alwaysApply: false }, skill.instructions),
    },
    loses: [...filesLost(skill, 'A Cursor rule'), ...loses],
  };
}
