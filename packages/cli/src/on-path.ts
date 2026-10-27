import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DISCOVERED_AGENT_KIND, pathValueOf } from '@memnox/core';
import { WINDOWS, windowsCandidatesIn } from '@memnox/interceptors';

/**
 * Whether a binary is on PATH, walked here rather than asked of a shell: `command -v`
 * under `shell: true` prints a Node deprecation warning over the command's own output.
 */
export function onPath(
  binary: string,
  path = pathValueOf(process.env),
  isFound: (candidate: string) => boolean = executable,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const windows = platform === WINDOWS;
  // An explicit path is not a PATH lookup: the caller already said where it is.
  if (binary.includes('/') || (windows && binary.includes('\\'))) return isFound(binary);
  return path
    .split(windows ? ';' : delimiter)
    .some((entry) => entry !== '' && candidatesIn(entry, binary, windows).some(isFound));
}

/** On Windows `claude` is `claude.exe` or `claude.cmd`, found through PATHEXT as a shell would. */
function candidatesIn(entry: string, binary: string, windows: boolean): string[] {
  if (!windows) return [join(entry, binary)];
  return windowsCandidatesIn(entry, binary, process.env['PATHEXT']);
}

function executable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    // Not here, which is the ordinary case for all but one entry on the list.
    return false;
  }
}

/**
 * What an agent's binary is called, where it is not the agent's own name: the scan
 * prints `claude-code` and the executable is `claude`.
 */
const BINARY_FOR: Record<string, string> = {
  [DISCOVERED_AGENT_KIND.CLAUDE_CODE]: 'claude',
  [DISCOVERED_AGENT_KIND.CODEX_CLI]: 'codex',
  [DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP]: 'claude',
};

/** The binary somebody meant, when the name they typed is an agent kind and not one. */
export function binaryMeantBy(name: string): string | null {
  const binary = BINARY_FOR[name];
  return binary === undefined || !onPath(binary) ? null : binary;
}
