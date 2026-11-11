import { execFileSync } from 'node:child_process';

import {
  ACTION,
  describeOthersWork,
  LeaseRegistry,
  normalizeShellCommand,
  othersInCommit,
  resolveShellLine,
} from '@memnox/core';

import type { SeamLeases } from './seam-runtime';

/** What the shell seam already has that the question needs. */
export interface SharedCommitDeps {
  leases?: SeamLeases;
  home?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** What a commit would take, read from git; injected so a test needs no repository. */
  stagedFiles?: (root: string, all: boolean) => string[];
}

/**
 * The question to ask when a commit in this line would take files another agent still holds,
 * or null when it takes only its own. A machine with one agent has no register and pays nothing.
 */
export async function othersInThisCommit(
  line: string,
  deps: SharedCommitDeps,
): Promise<string | null> {
  const { leases, home } = deps;
  if (leases === undefined || home === undefined) return null;
  const commit = commitOf(line, deps.env ?? {});
  if (commit === null) return null;
  const files = (deps.stagedFiles ?? stagedFiles)(leases.repositoryRoot, commit.all);
  if (files.length === 0) return null;
  const moment = (deps.now ?? ((): Date => new Date()))().toISOString();
  const inForce = await new LeaseRegistry(home).held(moment).catch(() => []);
  const others = othersInCommit(files, inForce, {
    sessionId: leases.holder.sessionId,
    repository: leases.repositoryRoot,
  });
  return others.length === 0 ? null : describeOthersWork(others);
}

/** A `git commit` in the line, and whether it stages every tracked change itself. */
function commitOf(line: string, env: NodeJS.ProcessEnv): { all: boolean } | null {
  const commits = resolveShellLine(line, env).actions.some(
    (each) => each.action === ACTION.GIT_COMMIT,
  );
  if (!commits) return null;
  const all = normalizeShellCommand(line).parsed.some(
    (command) =>
      command.argv[0] === 'git' &&
      command.argv.some(
        (word) => word === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(word),
      ),
  );
  return { all };
}

/** Repository relative, as leases hold them; nothing where git cannot be asked. */
function stagedFiles(root: string, all: boolean): string[] {
  const read = (args: readonly string[]): string[] => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
        .split('\n')
        .filter((each) => each.trim() !== '');
    } catch {
      return [];
    }
  };
  const staged = read(['diff', '--cached', '--name-only']);
  return all ? [...new Set([...staged, ...read(['diff', '--name-only'])])] : staged;
}
