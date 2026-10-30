import { DISCOVERED_AGENT_KIND } from '../../discovery/discovery.constants';
import type { CanonicalSkill } from '../skill';
import {
  filesLost,
  toolsLost,
  withHeader,
  type FormatPlace,
  type SkillFormat,
  type Translation,
} from './translation';

/**
 * Windsurf has no skills, so a skill becomes a workflow: one Markdown file Cascade runs only when
 * the person types its name, in `.windsurf/workflows` of a repository or the global workflows folder.
 */

/** Where Windsurf keeps its own settings, the folder its detector reads, so its presence says it is installed. */
const WINDSURF_HOME = '.codeium/windsurf';

/** Windsurf reads at most this many characters of a workflow, as its documentation says. */
export const MOST_WORKFLOW_CHARACTERS = 12_000;

export const WINDSURF_FORMAT: SkillFormat = {
  agent: DISCOVERED_AGENT_KIND.WINDSURF,
  label: 'Windsurf',
  installedDir: WINDSURF_HOME,
  translate: windsurfWorkflow,
};

function windsurfWorkflow(skill: CanonicalSkill, place: FormatPlace): Translation {
  const { name, description } = skill.manifest;
  const dir = place.project ? '.windsurf/workflows' : `${WINDSURF_HOME}/global_workflows`;
  const whole = withHeader({ description }, skill.instructions);
  const fits = whole.length <= MOST_WORKFLOW_CHARACTERS;
  return {
    file: {
      path: `${dir}/${name}.md`,
      content: fits ? whole : withinLimit(description, skill.instructions),
    },
    loses: [
      `Windsurf has no skills, so it runs only when typed as /${name}.`,
      ...(fits
        ? []
        : [
            `Windsurf reads ${MOST_WORKFLOW_CHARACTERS} characters of a workflow, so the instructions past that are left out.`,
          ]),
      ...filesLost(skill, 'A Windsurf workflow'),
      ...toolsLost(skill, 'Windsurf'),
    ],
  };
}

/** The instructions cut at the last whole line that fits, header and marker included. */
function withinLimit(description: string, instructions: string): string {
  const room = MOST_WORKFLOW_CHARACTERS - withHeader({ description }, '').length;
  const cut = instructions.slice(0, Math.max(room, 0));
  const lastLine = cut.lastIndexOf('\n');
  return withHeader({ description }, lastLine > 0 ? cut.slice(0, lastLine) : cut);
}
