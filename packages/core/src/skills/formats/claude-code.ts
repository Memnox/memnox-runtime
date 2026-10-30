import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  skillFolder,
  withHeader,
  type SkillFormat,
  type Translation,
} from './translation';

/** Claude Code reads a skill folder whole, header and tool grant included, so nothing is lost. */
export const CLAUDE_CODE_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.CLAUDE_CODE,
  label: 'Claude Code',
  installedDir: '.claude',
  translate: claudeCodeSkill,
};

function claudeCodeSkill(skill: CanonicalSkill): Translation {
  const { name, description, tools } = skill.manifest;
  const instructions = withHeader(
    { name, description, 'allowed-tools': tools.length === 0 ? undefined : tools },
    skill.instructions,
  );
  return {
    folder: skillFolder(`.claude/skills/${name}`, skill, instructions),
    loses: [],
  };
}
