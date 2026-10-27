import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

/**
 * Whether a terminal's program in front is a coding agent, so spoken words are only ever typed into
 * an agent and never into a bare shell.
 */

/** What runs a coding agent in a terminal, so text is only ever typed into the agent and never a shell. */
const AGENT_PROGRAMS = /^(claude|node|codex|gemini|cursor-agent|aider|opencode)$/i;

/** A native install runs a binary named for its version, like `~/.local/share/claude/versions/2.1.3`, so its folder names the agent. */
const AGENT_FOLDERS =
  /\/(claude|codex|gemini|cursor-agent|aider|opencode)\/(versions\/)?[^/]+$/i;

/** Whether the program in front is an agent, by its name or by the folder a native install keeps it in. */
export function isAgentProgram(command: string): boolean {
  return AGENT_PROGRAMS.test(basename(command)) || AGENT_FOLDERS.test(command);
}

/** Whether the terminal's foreground program is a coding agent, so the words never land in a bare shell. */
export function agentInForeground(tty: string): boolean {
  try {
    const listing = execFileSync('ps', ['-o', 'stat=,comm=', '-t', basename(tty)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return listing.split('\n').some((line) => {
      const [stat, ...command] = line.trim().split(/\s+/);
      return stat?.includes('+') === true && isAgentProgram(command.join(' '));
    });
  } catch {
    // No such terminal, or ps refused: nothing is typed anywhere unseen.
    return false;
  }
}
