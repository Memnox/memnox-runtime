import { stringify as stringifyToml } from 'smol-toml';
import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import { tomlMarked } from '../../distribute/native-files';
import type { CanonicalSkill } from '../skill';
import { filesLost, toolsLost, type SkillFormat, type Translation } from './translation';

/** Gemini CLI has no skills, so a skill becomes a command the person types, which runs only when typed. */
export const GEMINI_CLI_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.GEMINI_CLI,
  label: 'Gemini CLI',
  installedDir: '.gemini',
  translate: geminiCommand,
};

function geminiCommand(skill: CanonicalSkill): Translation {
  const { name, description } = skill.manifest;
  return {
    file: {
      path: `.gemini/commands/${name}.toml`,
      content: tomlMarked(
        stringifyToml({ description, prompt: skill.instructions.trim() }),
      ),
    },
    loses: [
      `Gemini CLI has no skills, so it runs only when typed as /${name}.`,
      ...filesLost(skill, 'A Gemini CLI command'),
      ...toolsLost(skill, 'Gemini CLI'),
    ],
  };
}
