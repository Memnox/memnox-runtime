import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  filesLost,
  withHeader,
  type FormatPlace,
  type SkillFormat,
  type Translation,
} from './translation';

/** OpenCode reads a skill as a subagent it hands work to, one file, with tools turned on by kind. */
export const OPENCODE_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.OPENCODE,
  label: 'OpenCode',
  installedDir: '.config/opencode',
  translate: opencodeAgent,
};

function opencodeAgent(skill: CanonicalSkill, place: FormatPlace): Translation {
  const { name, description, tools } = skill.manifest;
  const dir = place.project ? '.opencode/agents' : '.config/opencode/agents';
  return {
    file: {
      path: `${dir}/${name}.md`,
      content: withHeader({ description, mode: 'subagent' }, skill.instructions),
    },
    loses: [
      ...filesLost(skill, 'An OpenCode agent'),
      ...(tools.length === 0
        ? []
        : ['OpenCode turns tools on by kind, so the named tools are not carried.']),
    ],
  };
}
