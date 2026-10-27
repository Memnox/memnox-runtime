/**
 * What governs an agent on Windows, said per seam, so `doctor` reports a Windows machine as
 * it is: the proxy, the hook, the interceptors and the daemon run there; the kernel guard does not.
 */
import { DISCOVERED_AGENT_KIND, type DiscoveredAgentKind } from './discovery.constants';

export const WINDOWS_SEAM_COVERAGE = {
  /** Runs on Windows itself, not only inside WSL. */
  NATIVE: 'native',
  /** Exists on macOS or Linux and has no Windows counterpart yet. */
  NOT_ON_WINDOWS: 'not-on-windows',
} as const;

export type WindowsSeamCoverage =
  (typeof WINDOWS_SEAM_COVERAGE)[keyof typeof WINDOWS_SEAM_COVERAGE];

export interface SeamOnWindows {
  seam: string;
  coverage: WindowsSeamCoverage;
  detail: string;
}

const PROXY: SeamOnWindows = {
  seam: 'MCP proxy',
  coverage: WINDOWS_SEAM_COVERAGE.NATIVE,
  detail: 'a Node process on stdio, the same as on macOS and Linux',
};

const INTERCEPTORS: SeamOnWindows = {
  seam: 'PATH interceptors',
  coverage: WINDOWS_SEAM_COVERAGE.NATIVE,
  detail: '.cmd shims for cmd.exe and PowerShell, scripts for Git Bash',
};

const HOOK: SeamOnWindows = {
  seam: 'Claude Code hook',
  coverage: WINDOWS_SEAM_COVERAGE.NATIVE,
  detail: 'Claude Code runs the hook command itself before each tool call',
};

const KERNEL_GUARD: SeamOnWindows = {
  seam: 'kernel guard',
  coverage: WINDOWS_SEAM_COVERAGE.NOT_ON_WINDOWS,
  detail: 'sandbox-exec is macOS and Landlock is Linux, and Windows has neither here yet',
};

const SHELL_WRAPPER: SeamOnWindows = {
  seam: 'memnox-shell as the agent shell',
  coverage: WINDOWS_SEAM_COVERAGE.NOT_ON_WINDOWS,
  detail:
    'Claude Code on Windows starts its own bash.exe, so commands are gated inside Git Bash',
};

/** One agent on a Windows machine: what reaches it there, and what does not exist there. */
export interface AgentOnWindows {
  agentId: string;
  native: SeamOnWindows[];
  missing: SeamOnWindows[];
}

/** The hook reaches Claude Code only; every agent shares the proxy and the interceptors. */
function seamsFor(kind: DiscoveredAgentKind): SeamOnWindows[] {
  return kind === DISCOVERED_AGENT_KIND.CLAUDE_CODE
    ? [PROXY, INTERCEPTORS, HOOK, KERNEL_GUARD, SHELL_WRAPPER]
    : [PROXY, INTERCEPTORS, KERNEL_GUARD];
}

/** Per agent, split into what governs it natively on Windows and what is not available there. */
export function windowsCoverageFor(
  agents: readonly { id: string; kind: DiscoveredAgentKind }[],
): AgentOnWindows[] {
  return agents.map((agent) => {
    const seams = seamsFor(agent.kind);
    return {
      agentId: agent.id,
      native: seams.filter((seam) => seam.coverage === WINDOWS_SEAM_COVERAGE.NATIVE),
      missing: seams.filter(
        (seam) => seam.coverage === WINDOWS_SEAM_COVERAGE.NOT_ON_WINDOWS,
      ),
    };
  });
}
