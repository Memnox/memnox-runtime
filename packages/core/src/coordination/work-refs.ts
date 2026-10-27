import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/**
 * What a session's work declares about its feature, read off the checkout and never guessed:
 * the branch and its ticket keys, which the workspace joins across people's agents (`9`).
 */

/** Branches every repository has, which say nothing about which feature this is. */
const SHARED_BRANCHES: readonly string[] = [
  'main',
  'master',
  'develop',
  'development',
  'dev',
  'trunk',
  'staging',
  'production',
  'prod',
  'release',
  'head',
];

/** Words a branch is often named with that are no ticket's prefix, like `release-2026`. */
const NOT_TICKET_PREFIXES: readonly string[] = [
  'v',
  'release',
  'hotfix',
  'fix',
  'feat',
  'feature',
  'bug',
  'bugfix',
  'chore',
  'wip',
  'test',
  'rc',
  'beta',
  'alpha',
  'node',
  'py',
  'build',
  'version',
  'phase',
  'step',
  'part',
  'sprint',
  'week',
  'day',
  'year',
  'q',
];

/** Last segments too generic to say two branches are one feature, like `fix` or `wip`. */
const SHORTEST_BRANCH_NAME = 4;
const TICKET_KEY = /(?:^|[^a-z0-9])([a-z][a-z0-9]{1,9})-(\d{1,6})(?=$|[^0-9])/gi;
const HEAD_REF = /^ref:\s*refs\/heads\/(.+)$/m;
const GIT_DIR_LINE = /^gitdir:\s*(.+)$/m;
const MOST_TICKETS = 4;

/** The refs a branch declares: its ticket keys, then the branch itself. */
export function workRefsOfBranch(branch: string | null): string[] {
  if (branch === null) return [];
  const name = branch.trim();
  if (name === '' || SHARED_BRANCHES.includes(name.toLowerCase())) return [];
  const tickets = new Set<string>();
  for (const match of name.matchAll(TICKET_KEY)) {
    const [, prefix, number] = match;
    if (prefix === undefined || number === undefined) continue;
    if (NOT_TICKET_PREFIXES.includes(prefix.toLowerCase())) continue;
    tickets.add(`ticket:${prefix.toUpperCase()}-${number}`);
  }
  const last = name.split('/').at(-1) ?? name;
  const branchRef =
    last.length < SHORTEST_BRANCH_NAME || NOT_TICKET_PREFIXES.includes(last.toLowerCase())
      ? []
      : [`branch:${last.toLowerCase()}`];
  return [...[...tickets].slice(0, MOST_TICKETS), ...branchRef];
}

/** The branch this checkout is on, read from its HEAD, or null when detached or unreadable. */
export async function currentBranch(root: string): Promise<string | null> {
  const dot = join(root, '.git');
  const pointer = await readFile(dot, 'utf8').catch(() => null);
  // A worktree's `.git` is a file naming its git directory; a clone's is the directory itself.
  const gitDir = pointer === null ? dot : gitDirOf(pointer, root);
  if (gitDir === null) return null;
  const head = await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null);
  const branch = head === null ? undefined : HEAD_REF.exec(head)?.[1];
  return branch === undefined ? null : branch.trim();
}

/** The refs this checkout's work declares now. */
export async function workRefsAt(root: string): Promise<string[]> {
  return workRefsOfBranch(await currentBranch(root));
}

function gitDirOf(pointer: string, root: string): string | null {
  const named = GIT_DIR_LINE.exec(pointer)?.[1]?.trim();
  if (named === undefined || named === '') return null;
  return isAbsolute(named) ? named : join(root, named);
}
