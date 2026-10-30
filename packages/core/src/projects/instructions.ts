import { DISCOVERED_AGENT_KIND } from '../discovery/discovery.constants';
import {
  markdownMarked,
  OURS_MARKER,
  withoutNativeBlock,
  type NativeBlockMarkers,
} from '../distribute/native-files';

/**
 * A project's instructions, read from every agent's own file and written into each agent's own
 * file, so whichever agent opens the repository reads what the others were told.
 */

/** The single files agents read their instructions from, at the top of a repository. */
export const INSTRUCTION_FILES: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
];

/** Cursor's rules, a folder of files read on their own and the single file it read before them. */
export const CURSOR_RULES_DIR = '.cursor/rules';
export const CURSOR_RULES_FILE = '.cursorrules';

/** The fence around what Memnox wrote inside a person's instructions, which nothing outside it touches. */
export const INSTRUCTION_MARKERS: NativeBlockMarkers = {
  begin: `<!-- ${OURS_MARKER}: the project's instructions from its other agents' files -->`,
  end: '<!-- memnox: end of the project instructions -->',
};

/** Where an agent reads a project's instructions: a block inside a shared file, or a whole file of ours. */
export interface InstructionTarget {
  agent: string;
  path: string;
  /** A whole file of ours rather than a block inside a person's. */
  whole: boolean;
}

/** Cursor reads every file in its rules folder, so ours is a file of its own there. */
const CURSOR_TARGET = `${CURSOR_RULES_DIR}/memnox-project.mdc`;

export const INSTRUCTION_TARGETS: readonly InstructionTarget[] = [
  { agent: DISCOVERED_AGENT_KIND.CLAUDE_CODE, path: 'CLAUDE.md', whole: false },
  { agent: DISCOVERED_AGENT_KIND.CODEX_CLI, path: 'AGENTS.md', whole: false },
  { agent: DISCOVERED_AGENT_KIND.OPENCODE, path: 'AGENTS.md', whole: false },
  { agent: DISCOVERED_AGENT_KIND.GEMINI_CLI, path: 'GEMINI.md', whole: false },
  { agent: DISCOVERED_AGENT_KIND.CURSOR, path: CURSOR_TARGET, whole: true },
  {
    agent: DISCOVERED_AGENT_KIND.COPILOT_CLI,
    path: '.github/copilot-instructions.md',
    whole: false,
  },
];

export function instructionTargetFor(agent: string): InstructionTarget | undefined {
  return INSTRUCTION_TARGETS.find((target) => target.agent === agent);
}

/** One source as read from the repository, by its path there. */
export interface InstructionSource {
  path: string;
  text: string;
}

/** A source of ours is never read back as the person's, or two agents' files would copy each other for ever. */
export function isOwnInstructionFile(path: string): boolean {
  return path === CURSOR_TARGET;
}

/** What a source says once anything Memnox wrote into it is taken out. */
export function sourceText(source: InstructionSource): string {
  return withoutNativeBlock(source.text, INSTRUCTION_MARKERS).trim();
}

/**
 * The instructions an agent is handed in its own file: every other source, each under its name.
 * Empty when the only source is that very file, which the agent already reads.
 */
export function instructionBody(
  target: InstructionTarget,
  sources: readonly InstructionSource[],
): string {
  const parts = sources
    .filter((source) => source.path !== target.path && !isOwnInstructionFile(source.path))
    .map((source) => ({ path: source.path, text: sourceText(source) }))
    .filter((source) => source.text !== '')
    .map((source) => `## From ${source.path}\n\n${source.text}`);
  if (parts.length === 0) return '';
  const intro =
    "This project keeps instructions in other agents' files too. Memnox copies them here, so read them as this project's own.";
  return `${intro}\n\n${parts.join('\n\n')}`;
}

/** Cursor's file of ours: always applied, and marked so it is only ever replaced or removed by Memnox. */
export function cursorRuleText(body: string): string {
  return markdownMarked(
    `---\ndescription: The project's instructions from its other agents' files\nalwaysApply: true\n---\n\n${body}`,
  );
}
