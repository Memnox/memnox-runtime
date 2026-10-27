import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_PLACES, STARTABLE_AGENT, type StartableAgent } from '@memnox/core';

/**
 * Whether an agent the person asked to start is installed on this Mac, found the way the new
 * terminal tab will find it, and what to say when it is not.
 */

/** What to say when the agent's command is nowhere on this Mac, with the agents that are. */
export function notInstalled(
  agent: StartableAgent,
  resolve: (agent: StartableAgent) => string | null,
): { missing: string; installed: string[]; said: string } {
  const installed = (Object.keys(STARTABLE_AGENT) as StartableAgent[]).filter(
    (each) => resolve(each) !== null,
  );
  return {
    missing: STARTABLE_AGENT[agent],
    installed,
    said: `The ${STARTABLE_AGENT[agent]} command is nowhere on this Mac, neither on PATH nor where it is usually installed, so that agent cannot be started from a terminal. Say so plainly, and offer one from installed if there is one.`,
  };
}

/** The agent's bare command when the person's own shell finds it, else the full path it is installed at. */
export function resolveInstalled(agent: StartableAgent): string | null {
  const command = STARTABLE_AGENT[agent];
  if (inShell(command)) return command;
  return (
    INSTALL_PLACES[agent]
      .map((place) => (place.startsWith('~/') ? join(homedir(), place.slice(2)) : place))
      .find(runnable) ?? null
  );
}

/** Asked of an interactive login shell, since that is the PATH the new terminal tab will have, `.zshrc` included. */
function inShell(command: string): boolean {
  try {
    execFileSync(process.env['SHELL'] ?? '/bin/zsh', ['-lic', `command -v ${command}`], {
      stdio: 'ignore',
      timeout: 6_000,
    });
    return true;
  } catch {
    return false;
  }
}

function runnable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
