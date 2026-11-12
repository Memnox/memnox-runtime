import type { RunTerminal } from '../discovery/run-terminal';
import type { SessionHost } from '../discovery/session-host';

/**
 * A run cut off by a crash, a reboot or a closed laptop, picked up where it was rather than
 * started over. A run that ends normally forgets its own record, so a record left behind
 * whose process is gone is one that was interrupted.
 */

export interface InterruptedRun {
  sessionId: string;
  agent: string;
  cwd: string;
  startedAt: string;
  /** The agent's own command line, as `memnox run` was handed it. */
  command: string[];
  /** The `memnox run` options that shaped it: its task, role, person and mission. */
  relaunch: string[];
  /** The agent's own conversation id, which is what lets it pick up rather than start over. */
  conversationId?: string;
}

/** The runs whose process is gone and which nothing closed, newest first. */
export function interruptedRuns(
  runs: readonly RunTerminal[],
  hosts: readonly SessionHost[],
  alive: (pid: number) => boolean,
): InterruptedRun[] {
  const hostOf = new Map(hosts.map((host) => [host.sessionId, host]));
  return runs
    .filter((run) => !alive(run.pid) && hostOf.get(run.sessionId)?.endedAt === undefined)
    .map((run) => {
      const conversation = hostOf.get(run.sessionId)?.agentSession;
      return {
        sessionId: run.sessionId,
        agent: run.agent,
        cwd: run.cwd,
        startedAt: run.startedAt,
        command: run.command ?? [run.agent],
        relaunch: run.relaunch ?? [],
        ...(conversation === undefined ? {} : { conversationId: conversation }),
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** How each agent picks a conversation back up, by the binary its command line starts with. */
const RESUME_SHAPE: Readonly<
  Record<string, (command: string[], id: string) => string[]>
> = {
  claude: (command, id) => [...command, '--resume', id],
  codex: (command, id) => [command[0] ?? 'codex', 'resume', id],
};

/**
 * The `memnox run` arguments that start it again: the same options, and the agent told to pick
 * up its own conversation where it knows how. An agent with no known way starts fresh, which
 * `resumes` says so nobody is told it picked up when it did not.
 */
export function relaunchOf(run: InterruptedRun): { argv: string[]; resumes: boolean } {
  const binary = run.command[0] ?? run.agent;
  const shape = RESUME_SHAPE[binary.split('/').pop() ?? binary];
  const agentArgv =
    shape !== undefined && run.conversationId !== undefined
      ? shape(run.command, run.conversationId)
      : run.command;
  return {
    argv: ['run', ...run.relaunch, '--', ...agentArgv],
    resumes: agentArgv !== run.command,
  };
}
