import { execFileSync } from 'node:child_process';
import { ownProcessEnv, rememberRepository } from '@memnox/core';
import { wrapEveryServer } from './mcp/wrap-servers';
import { installClaudeHook } from './protect/claude-hook';
import { writeHookLauncher } from './protect/hook-launcher';
import { installHermesPlugin } from './protect/hermes-plugin';
import { installOpenClawPlugin } from './protect/openclaw-plugin';
import { installCopilotHook, installDevinHook } from './protect/named-host-hooks';
import { installOpenCodePlugin } from './protect/opencode-plugin';
import { installOwnInterceptors } from './protect/interceptor-entry';
import {
  installCodexHook,
  installCursorHook,
  installGeminiHook,
  installWindsurfHook,
} from './protect/agent-hooks';
import {
  baselineRules,
  retireBaselineCopies,
  writeMachineRules,
} from './protect/machine-rules';
import { installService, type InstallResult } from './daemon/service';
import { keepBoundary } from './keeper/kept';
import { wireSessionTools } from './session-tools/session-entry';

/**
 * The wiring that turns an enrolled machine into a governed one, each step calling what
 * already owns it so `memnox uninstall` can take them all back out.
 */

export const WIRED = {
  DONE: 'done',
  /** The platform has no per-user service manager, which is not a failure. */
  UNSUPPORTED: 'unsupported',
  FAILED: 'failed',
} as const;

export type WiredState = (typeof WIRED)[keyof typeof WIRED];

export interface Wiring {
  /** Wrappers now in `~/.memnox/bin`. Zero means nothing is gated. */
  interceptors: number;
  /** Binaries a rule could cover that this machine does not have. */
  absent: number;
  rules: number;
  daemon: WiredState;
  /** Set when the service file was written but the manager would not take it. */
  daemonNote?: string;
  /** Whether Claude Code now takes a lease before it writes a file. */
  claudeHook: boolean;
  /** The other coding agents that now take one too, by name, hooked only where installed. */
  editHooks: string[];
  /** The repository the daemon now watches for edits by anything with no hooks. */
  watching?: string;
  /** MCP servers now reached through the proxy. */
  mcpServers: number;
  /** Set where the proxy is not on PATH, so wrapping would break the agents. */
  mcpUnwrapped?: true;
  /** Agents that can now ask Memnox from inside a session, through the session server. */
  sessionTools?: string[];
  /** Baseline copies an earlier setup wrote into a directory, no longer read. */
  retired?: string[];
}

export interface WiringSeams {
  interceptors?: typeof installOwnInterceptors;
  service?: typeof installService;
  /** Injected so a test writes no policy file under a real home. */
  rules?: (home: string) => Promise<number>;
  retire?: (home: string) => Promise<string[]>;
  claudeHook?: (home: string) => Promise<boolean>;
  codexHook?: (home: string) => Promise<boolean>;
  cursorHook?: (home: string) => Promise<boolean>;
  geminiHook?: (home: string) => Promise<boolean>;
  windsurfHook?: (home: string) => Promise<boolean>;
  hermesHook?: (home: string) => Promise<boolean>;
  openClawHook?: (home: string) => Promise<boolean>;
  copilotHook?: (home: string) => Promise<boolean>;
  devinHook?: (home: string) => Promise<boolean>;
  launcher?: (home: string) => Promise<string>;
  openCodeHook?: (home: string) => Promise<boolean>;
  mcp?: (home: string, project: string) => Promise<{ wrapped: number; skipped: boolean }>;
  keep?: (home: string, hooked: readonly string[]) => Promise<void>;
  session?: (home: string) => Promise<{ held: string[] }>;
}

/**
 * The baseline every machine starts with, in the machine's own file and merged rather than
 * written over, or a second run quietly undoes somebody's edits. Nothing is written where
 * setup was run, so it can be run from anywhere and every repository is held the same.
 */
async function writeBaseline(home: string): Promise<number> {
  const { machine, project } = baselineRules();
  await writeMachineRules(home, [...machine, ...project]);
  return machine.length + project.length;
}

/** The copies earlier setups left behind, no longer read now the baseline is the machine's. */
function retireCopies(home: string): Promise<string[]> {
  const { machine, project } = baselineRules();
  return retireBaselineCopies(home, [...machine, ...project]);
}

export async function wireMachine(
  home: string,
  cwd: string,
  seams: WiringSeams = {},
): Promise<Wiring> {
  // Every hook below names the launcher, so it is written before any of them.
  await (seams.launcher ?? writeHookLauncher)(home);
  const installed = await (seams.interceptors ?? installOwnInterceptors)(home);
  const rules = await (seams.rules ?? writeBaseline)(home);
  const retired = await (seams.retire ?? retireCopies)(home);
  const service = await (seams.service ?? installService)(home);
  const claudeHook = await (seams.claudeHook ?? installClaudeHook)(home);
  const editHooks = await installEditHooks(home, seams);
  // The machine's own configs: a repository's is wrapped once a session there is watched.
  const mcp = await (seams.mcp ?? wrapEveryServer)(home, home);
  const session = await (seams.session ?? wireSessionTools)(home);
  // Agents here work in this repository, so the daemon watches it for unhooked edits.
  const root = repositoryOf(cwd);
  if (root !== null) rememberRepository(home, root);
  // Written last, so the daemon starts keeping only what this run actually put in place.
  await (seams.keep ?? keepBoundary)(home, [
    ...(claudeHook ? ['Claude Code'] : []),
    ...editHooks,
  ]);

  return {
    interceptors: installed.installed.length,
    absent: installed.absent.length,
    rules,
    daemon: daemonState(service),
    claudeHook,
    ...(root === null ? {} : { watching: root }),
    editHooks,
    mcpServers: mcp.wrapped,
    ...(mcp.skipped ? { mcpUnwrapped: true as const } : {}),
    sessionTools: session.held,
    ...(retired.length === 0 ? {} : { retired }),
    ...(service.warning === undefined ? {} : { daemonNote: service.warning }),
  };
}

/** Every other agent that writes files from inside itself, by the name a screen prints. */
async function installEditHooks(home: string, seams: WiringSeams): Promise<string[]> {
  const hooked: string[] = [];
  if (await (seams.codexHook ?? installCodexHook)(home)) hooked.push('Codex');
  if (await (seams.cursorHook ?? installCursorHook)(home)) hooked.push('Cursor');
  if (await (seams.geminiHook ?? installGeminiHook)(home)) hooked.push('Gemini CLI');
  if (await (seams.windsurfHook ?? installWindsurfHook)(home)) hooked.push('Windsurf');
  if (await (seams.hermesHook ?? installHermesPlugin)(home)) hooked.push('Hermes');
  if (await (seams.openClawHook ?? installOpenClawPlugin)(home)) hooked.push('OpenClaw');
  if (await (seams.copilotHook ?? installCopilotHook)(home)) hooked.push('Copilot CLI');
  if (await (seams.devinHook ?? installDevinHook)(home)) hooked.push('Devin');
  if (await (seams.openCodeHook ?? installOpenCodePlugin)(home)) hooked.push('OpenCode');
  return hooked;
}

function daemonState(service: InstallResult): WiredState {
  if (!service.state.supported) return WIRED.UNSUPPORTED;
  return service.state.installed ? WIRED.DONE : WIRED.FAILED;
}

/** The repository `cwd` is in, or null where it is in none. */
function repositoryOf(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      // Setup's own question, so it goes to the real git rather than through the gate.
      env: ownProcessEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Not a repository, or no git: nothing to watch from here.
    return null;
  }
}
