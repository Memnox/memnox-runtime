import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_HOOK_BINARY, WINDOWS } from '@memnox/interceptors';
import { chooseNode } from '../node-choice';

/**
 * Every agent's hook runs through one launcher at a path that never moves. The Node and the
 * build it runs change with every update and are written only into the launcher, so a host
 * that trusts a hook by a hash of its entry, as Codex does, approves it once and for good.
 */

export const HOOK_LAUNCHER = join('.memnox', 'hooks', EDIT_HOOK_BINARY);
const EXECUTABLE = 0o755;
/** The CLI beside the built hook, which a Node is checked against before it is trusted to run it. */
const CLI_ENTRY = join('..', 'index.js');

/** The built hook script beside this module, which only a build has. */
export function builtHookScript(): string {
  return fileURLToPath(new URL('./bin/edit-hook.js', import.meta.url));
}

/** Windows runs no sh script, so its hooks name what the launcher would have run. */
export function usesLauncher(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== WINDOWS;
}

export function launcherPath(home: string): string {
  return join(home, HOOK_LAUNCHER);
}

/** What runs the hook: a Node of the person's own and the built script, or the bare name without a build. */
export function hookRunnerArgv(
  exists: (file: string) => boolean = existsSync,
  sibling: string = builtHookScript(),
): string[] {
  if (!exists(sibling)) return [EDIT_HOOK_BINARY];
  return [
    chooseNode(join(dirname(sibling), CLI_ENTRY)),
    sibling,
    `--${EDIT_HOOK_BINARY}`,
  ];
}

/** The shell script that runs the hook, handing it every argument the entry gives. */
export function hookLauncherScript(runner: readonly string[] = hookRunnerArgv()): string {
  const quoted = runner.map((word) => `'${word.replace(/'/g, `'\\''`)}'`).join(' ');
  return `#!/bin/sh\n# Written by memnox setup. Hosts trust this path; only the line below moves.\nexec ${quoted} "$@"\n`;
}

/** The launcher written, executable, and rewritten only when what it runs moved. */
export async function writeHookLauncher(home: string): Promise<string> {
  const path = launcherPath(home);
  if (!usesLauncher()) return path;
  const script = hookLauncherScript();
  const current = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (current !== script) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, script, 'utf8');
  }
  await chmod(path, EXECUTABLE);
  return path;
}

/** Whether the launcher runs this install's hook, since an entry naming a stale one runs an old build. */
export function launcherIsCurrent(home: string): boolean {
  try {
    return readFileSync(launcherPath(home), 'utf8') === hookLauncherScript();
  } catch {
    // An entry naming a launcher that is gone is an entry that fails on every call.
    return false;
  }
}
