import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  DISPLAY,
  DisplayRequests,
  shortDigest,
  START_ID_PREFIX,
  START_TTL_MS,
  startableKindOf,
  startCommand,
  STARTABLE_AGENT,
  type AgentLaunched,
  type SessionStart,
  type StartableAgent,
} from '@memnox/core';
import { resolveInstalled } from '../session-tools/installed-agent';

/**
 * An agent opened in a new terminal from a screen: the Mac types `memnox run` with the agent's own
 * command into a fresh tab in the folder, so the run notes its terminal and every action is ruled on.
 */

interface LaunchInput {
  /** The agent as the screen named it, by kind. */
  agent: string | undefined;
  workingDirectory: string | undefined;
  now: Date;
  resolve?: (agent: StartableAgent) => string | null;
}

const ONLY_KNOWN = `Only ${Object.keys(STARTABLE_AGENT).join(', ')} have a launch command Memnox knows.`;

export async function launchAgent(
  home: string,
  input: LaunchInput,
): Promise<AgentLaunched | { refused: string }> {
  const agent = input.agent === undefined ? null : startableKindOf(input.agent);
  if (agent === null)
    return {
      refused: `${input.agent ?? 'That agent'} cannot be opened in a terminal. ${ONLY_KNOWN}`,
    };
  const folder = input.workingDirectory;
  if (folder === undefined || !isAbsolute(folder) || !(await isFolder(folder)))
    return { refused: 'Name a folder on this computer for the agent to open in.' };
  const command = (input.resolve ?? resolveInstalled)(agent);
  if (command === null)
    return {
      refused: `The ${STARTABLE_AGENT[agent]} command is not installed on this computer.`,
    };
  const start = startOf({ agent, command, folder, at: input.now.toISOString() });
  const line = startCommand(start);
  await new DisplayRequests(home).request({
    display: DISPLAY.LAUNCH,
    sessionId: start.id,
    agent,
    title: agent,
    text: line,
    cwd: folder,
    at: start.proposedAt,
  });
  return { agent, workingDirectory: folder, line };
}

/** A start with no task, so the agent opens waiting for its first prompt. */
function startOf(input: {
  agent: StartableAgent;
  command: string;
  folder: string;
  at: string;
}): SessionStart {
  return {
    id: `${START_ID_PREFIX}${Date.parse(input.at).toString(36)}_${shortDigest(`${input.agent}${input.folder}`)}`,
    agent: input.agent,
    command: input.command,
    repository: input.folder,
    task: '',
    proposedAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + START_TTL_MS).toISOString(),
  };
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Absent is the person's to fix, and is said as such rather than thrown.
    return false;
  }
}
