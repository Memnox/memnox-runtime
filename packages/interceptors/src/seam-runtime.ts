import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ownProcessEnv,
  CloudLeases,
  GitRegionReader,
  holderPid,
  holdFor,
  LeaseGate,
  LeaseRegistry,
  protectionStopped,
  rememberRepository,
  SHARED_LEASE_TIMEOUT_MS,
  ENV_AGENT_NAME,
  ENV_POLICIES,
  SESSION_VAR,
  TtyLeasePrompt,
  type HoldService,
  type LeaseHolder,
  type WrittenRegion,
  workRefsAt,
} from '@memnox/core';
import { projectIdentityOf, remoteIdentityOf } from './git-branch';
import { HookAuthorizer } from './hook-authorizer';
import { readHookConfig } from './hook-config';
import { loadHookGate } from './hook-gate-loader';
import { DEFAULT_AGENT_NAME } from './tool-hook.constants';

/**
 * What every seam process builds the same way:
 * its log, its authorizer, its leases, its hold.
 */

/**
 * stderr is the safe side channel, because stdout
 * belongs to whatever protocol is speaking.
 */
export function log(message: string): void {
  process.stderr.write(`[memnox] ${message}\n`);
}

// The environment first, then what was written
// to config: shared by every local interceptor.
export async function buildAuthorizer(): Promise<HookAuthorizer> {
  const config = await readHookConfig(process.env, homedir());
  const gate = await loadHookGate(config);
  if (gate === null) log(`no gate configured, so set ${ENV_POLICIES}`);
  return new HookAuthorizer({
    ...(gate === null ? {} : { gate }),
    stopped: () => protectionStopped(homedir()),
  });
}

export async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join('');
}

/**
 * The session a seam files its work under when `memnox
 * run` named none: the agent process above it.
 */
export function pidSessionId(pid: number): string {
  return `ses_pid_${pid}`;
}

export interface SeamLeases {
  gate: LeaseGate;
  holder: LeaseHolder;
  repositoryRoot: string;
  isDirectory: (path: string) => boolean;
}

/**
 * How a seam with nobody at a terminal takes a lease: an editor's hook, which shares its
 * host's terminal and is killed by its host if it waits as long as a person may.
 */
export interface UnattendedLeases {
  /** The editor's session, which is what makes a second write a renewal. */
  sessionId: string;
  /** The longest a held path is waited on. */
  waitMs: number;
  /** The agent the hook was installed for, when the environment does not name one. */
  agent?: string;
  /** What the write is about to touch, since a hook runs before the change lands. */
  region?: (path: string) => Promise<WrittenRegion>;
}

/**
 * The register, when there is a project to have one about. Outside a checkout only an
 * editor's hook has one, since a project root there is a guess a shell command should not
 * be held up by; an empty register never refuses.
 */
export function buildLeases(
  cwd: string = process.cwd(),
  unattended?: UnattendedLeases,
): SeamLeases | undefined {
  const root = repositoryRootOf(cwd);
  if (root === null) {
    if (unattended === undefined) return undefined;
    const project = projectRootOf(cwd, homedir());
    return project === null ? undefined : localLeases(project, unattended);
  }
  // The daemon watches the repositories seams have
  // seen, so an agent with no hooks is seen too.
  rememberRepository(homedir(), root);
  return checkoutLeases(root, unattended);
}

/** Both registers, the workspace's matched by the checkout's remote. */
function checkoutLeases(
  root: string,
  unattended: UnattendedLeases | undefined,
): SeamLeases {
  const remote = remoteIdentityOf(root);
  return {
    gate: new LeaseGate({
      registry: new LeaseRegistry(homedir()),
      // The workspace's register too, which calls nothing without an account and never stops a write.
      shared: new CloudLeases(
        homedir(),
        globalThis.fetch,
        SHARED_LEASE_TIMEOUT_MS,
        // Named by its remote, so two clones of one project meet and two projects named alike do not.
        remote,
        () => workRefsAt(root),
      ),
      // This machine's register serves every checkout on it, so each lease says which.
      repository: root,
      // And which project, so two worktrees of one repository meet here as they do in the workspace.
      ...withProject(projectIdentityOf(root, remote)),
      ...(unattended === undefined
        ? { prompt: new TtyLeasePrompt() }
        : { ceilingMs: unattended.waitMs }),
      // The lines and function a write touches, read off the change itself and bounded.
      region: unattended?.region ?? ((path) => new GitRegionReader(root).read(path)),
      now: () => new Date().toISOString(),
    }),
    holder: holderFor(unattended),
    repositoryRoot: root,
    isDirectory: (path: string) => isDirectoryIn(root, path),
  };
}

/**
 * This machine's register alone: a folder with no remote has nothing that names it on
 * another machine, and matching two by a relative path would hold up strangers.
 */
function localLeases(root: string, unattended: UnattendedLeases): SeamLeases {
  return {
    gate: new LeaseGate({
      registry: new LeaseRegistry(homedir()),
      repository: root,
      ceilingMs: unattended.waitMs,
      ...(unattended.region === undefined ? {} : { region: unattended.region }),
      now: () => new Date().toISOString(),
    }),
    holder: holderFor(unattended),
    repositoryRoot: root,
    isDirectory: (path: string) => isDirectoryIn(root, path),
  };
}

/** Files that say a folder is a project, which is what two agents in it share. */
const PROJECT_MARKERS: readonly string[] = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'mix.exs',
  'deno.json',
];

/**
 * The outermost folder above `cwd` that is a project, below the home folder, so a package
 * inside a workspace and the workspace itself land on one root. Null where none is.
 */
export function projectRootOf(cwd: string, home: string): string | null {
  const stop = resolve(home);
  let found: string | null = null;
  let at = resolve(cwd);
  // Only below home: a marker in home itself would make every folder one project.
  while (at !== stop && at.startsWith(`${stop}/`)) {
    const here = at;
    if (PROJECT_MARKERS.some((marker) => existsSync(join(here, marker)))) found = here;
    at = dirname(at);
  }
  return found;
}

function withProject(project: string | undefined): { project?: string } {
  return project === undefined ? {} : { project };
}

/**
 * The agent, never this wrapper, and never init, which no lease could be reclaimed from.
 */
function holderFor(unattended: UnattendedLeases | undefined): LeaseHolder {
  // A hook runs through a shell that exits the moment
  // it answers, so its owner is the editor above.
  const parent = unattended === undefined ? process.ppid : pastShell(process.ppid);
  const owner = holderPid(parent, process.pid);
  return {
    agent: process.env[ENV_AGENT_NAME] ?? unattended?.agent ?? DEFAULT_AGENT_NAME,
    // Without a session every command would be its own,
    // and no lease would survive to the next line.
    sessionId:
      process.env[SESSION_VAR] ??
      (unattended === undefined ? pidSessionId(owner) : unattended.sessionId),
    pid: owner,
  };
}

function isDirectoryIn(root: string, path: string): boolean {
  try {
    return statSync(resolve(root, path)).isDirectory();
  } catch {
    // Not there yet: a file about to be written, which claims its directory.
    return false;
  }
}
/** Shells a host may run a hook command through. */
const SHELLS: readonly string[] = ['sh', 'bash', 'zsh', 'dash'];

/**
 * The process above a shell, asked of `ps` because
 * Node names no grandparent. Falls back to `pid`.
 */
function pastShell(pid: number): number {
  try {
    const line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (match === null) return pid;
    const name = basename((match[2] ?? '').replace(/^-/, ''));
    return SHELLS.includes(name) ? Number(match[1]) : pid;
  } catch {
    // No `ps`, or the shell already gone: the parent is the best answer there is.
    return pid;
  }
}

/** The checkout `cwd` is in, or null outside one. */
export function repositoryRootOf(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      // The real git: the one on PATH is this interceptor, which would ask this again.
      env: ownProcessEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Not a repository, which is an answer rather than a failure.
    return null;
  }
}

/**
 * Somebody to ask, so an `ask` rule is not a synonym for
 * `deny`. The question is written to `~/.memnox/pending` first
 * and answered from this terminal, another, or the workspace.
 */
export function buildHold(timeoutMs?: number): HoldService {
  return holdFor({
    home: homedir(),
    // /dev/tty opens on a headless box often enough
    // to swallow the question, so stdin decides.
    interactive: process.stdin.isTTY === true,
    announce: log,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
