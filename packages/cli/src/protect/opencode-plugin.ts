import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EDIT_HOOK_BINARY, OPENCODE_AGENT, OPENCODE_EVENT } from '@memnox/interceptors';
import { AGENT_PLUGIN, filledPlugin } from './agent-plugin-template';
import { namedHookArgv, namedHookCommand } from './claude-hook';

/**
 * OpenCode loads every file in its global plugins directory at startup, so Memnox writes one
 * there: no config is edited. It hands each tool call to the same hook every other agent
 * runs and throws on a block, which is how OpenCode refuses a call from a plugin.
 */

const OPENCODE_DIR = join('.config', 'opencode');
export const OPENCODE_PLUGIN = join(OPENCODE_DIR, 'plugins', 'memnox.js');

/** OpenCode waits on a plugin with no limit of its own, so the plugin sets one. */
const PLUGIN_WAIT_MS = 290_000;

/** The plugin with the hook it runs written in. One export, since OpenCode loads every export as a plugin. */
export function openCodePluginSource(
  argv: readonly string[] = namedHookArgv(OPENCODE_AGENT),
  command: string = namedHookCommand(OPENCODE_AGENT),
): string {
  return filledPlugin(AGENT_PLUGIN.OPENCODE, {
    ARGV: JSON.stringify(argv),
    COMMAND: JSON.stringify(command),
    WAIT_MS: String(PLUGIN_WAIT_MS),
    EVENTS: JSON.stringify(OPENCODE_EVENT),
  });
}

/** The plugin written, only where OpenCode is installed. */
export async function installOpenCodePlugin(home: string): Promise<boolean> {
  if (!existsSync(join(home, OPENCODE_DIR))) return false;
  const path = join(home, OPENCODE_PLUGIN);
  const next = openCodePluginSource();
  const current = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (current !== next) {
    await mkdir(join(home, OPENCODE_DIR, 'plugins'), { recursive: true });
    await writeFile(path, next, 'utf8');
  }
  return true;
}

/** The plugin deleted, and only a file that runs the hook. True when it was there. */
export async function removeOpenCodePlugin(home: string): Promise<boolean> {
  const path = join(home, OPENCODE_PLUGIN);
  if (!existsSync(path)) return false;
  if (!(await readFile(path, 'utf8')).includes(EDIT_HOOK_BINARY)) return false;
  await rm(path, { force: true });
  return true;
}
