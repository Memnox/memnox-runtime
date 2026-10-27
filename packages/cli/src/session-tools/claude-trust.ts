import { join, resolve } from 'node:path';
import { readJsonFile } from '@memnox/core';

/**
 * Whether Claude Code was ever told to trust a folder, from its own record in `~/.claude.json`.
 * It asks that in its tab before it starts anywhere it has not, which is the one question a start
 * can be sure of without reading the screen.
 */

const CLAUDE_CONFIG = '.claude.json';

interface ClaudeProjects {
  projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
}

/** True once the person said yes there, false when it has a record and no yes, null when it has never opened the folder. */
export async function claudeTrusts(
  home: string,
  folder: string,
): Promise<boolean | null> {
  const config = await readJsonFile<ClaudeProjects>(join(home, CLAUDE_CONFIG));
  const project = config?.projects?.[resolve(folder)];
  if (project === undefined) return null;
  return project.hasTrustDialogAccepted === true;
}

/** The question as Claude Code puts it, with "No, exit" selected, so a yes is one line down. */
export const TRUST_QUESTION = 'Do you trust the files in this folder?';
export const TRUST_YES_KEYS = 'down enter';
