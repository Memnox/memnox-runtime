import type { DiscoveredAgentKind } from '../../discovery/discovery.constants';
import { markdownMarked } from '../../distribute/native-files';
import type { CanonicalSkill } from '../skill';

/**
 * What every agent format shares: where a translation lands, what it says it lost, and the
 * Markdown header each one writes with every value quoted, so a description can say anything.
 */

/** A skill written as a folder, whose marker file says the whole folder is ours. */
export interface TranslatedFolder {
  dir: string;
  markerFile: string;
  files: { relative: string; content: string | Uint8Array }[];
}

/** Paths are relative to the root the skill is written under: the home folder, or a repository. */
export type Translation =
  | { folder: TranslatedFolder; loses: string[] }
  | { file: { path: string; content: string }; loses: string[] };

/** Where it is written, which decides a few paths and whether a newer layout is there to use. */
export interface FormatPlace {
  /** Into a repository rather than the home folder. */
  project: boolean;
  /** The agent's own skills folder is already there at the root. */
  hasSkillsFolder: boolean;
}

export interface SkillFormat {
  agent: DiscoveredAgentKind;
  label: string;
  /** The folder under home whose presence says the agent is installed. */
  installedDir: string;
  translate(skill: CanonicalSkill, place: FormatPlace): Translation;
}

/** A YAML header with every value written as JSON, which YAML reads as it is. */
export function withHeader(
  fields: Record<string, string | string[] | boolean | undefined>,
  body: string,
): string {
  const lines = Object.entries(fields).flatMap(([key, value]) =>
    value === undefined ? [] : [`${key}: ${JSON.stringify(value)}`],
  );
  return markdownMarked(`---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`);
}

/** The instructions and every file beside them, as a folder whose instructions carry the marker. */
export function skillFolder(
  dir: string,
  skill: CanonicalSkill,
  instructions: string,
): TranslatedFolder {
  return {
    dir,
    markerFile: 'SKILL.md',
    files: [
      { relative: 'SKILL.md', content: instructions },
      ...skill.files.map((file) => ({ relative: file.path, content: file.bytes })),
    ],
  };
}

/** Said where an agent has no per skill tool grant. */
export function toolsLost(skill: CanonicalSkill, agent: string): string[] {
  if (skill.manifest.tools.length === 0) return [];
  return [
    `${agent} has no tool grant on a skill, so its tools (${skill.manifest.tools.join(', ')}) are not carried.`,
  ];
}

/** Said where an agent reads one file, so the files beside the instructions stay behind. */
export function filesLost(skill: CanonicalSkill, agent: string): string[] {
  const count = skill.files.length;
  if (count === 0) return [];
  return [
    `${agent} reads one file, so ${count === 1 ? 'the 1 file' : `the ${count} files`} beside the instructions ${count === 1 ? 'is' : 'are'} left out.`,
  ];
}
