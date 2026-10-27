import { basename, isAbsolute } from 'node:path';
import {
  HOUR_MS,
  LEDGER_SCAN_LIMIT,
  LEDGER_SESSION_LIMIT,
  NodeGit,
  SessionHosts,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { repositoriesOf } from './changes-tool';
import { MOST_ROWS } from './bounded';
import { knownRepositories, repositoryNamed } from './known-repositories';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { repositoryAround } from './repository-root';
import { scopeOf } from './session-scope';

/**
 * Which branch a session's repository is on, the commits made there since it started and the
 * branch's latest commits whoever made them, read from git itself, so "read the commit it just
 * made" and "what was the last commit" both have the commit to read.
 */

/** Enough commits to cover a working session, few enough to say out loud. */
const MOST_COMMITS = 10;
/** The branch's newest few, enough for "the last commit" and what came just before it. */
const LATEST_COMMITS = 5;
/** Enough repositories for one question, never a sweep of every folder touched. */
const MOST_REPOSITORIES = 3;
/** How far back to look for repositories and commits when no session is named or found. */
const RECENT_HOURS = 24;

interface Commit {
  sha: string;
  at: string;
  subject: string;
  files: string[];
}

/** A commit on the branch whoever made it, so the last commit is known though the session made none. */
interface LatestCommit {
  sha: string;
  at: string;
  author: string;
  subject: string;
}

export async function repositoryTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const since = new Date(deps.now().getTime() - RECENT_HOURS * HOUR_MS).toISOString();
  const found = await withEvents(deps.home, async (store) => {
    const scope = await scopeOf(store, deps, textArg(args, 'session'));
    const mine =
      scope.sessionId === null
        ? []
        : await store.query({ sessionId: scope.sessionId, limit: LEDGER_SESSION_LIMIT });
    const recent = await store.query({ since, limit: LEDGER_SCAN_LIMIT });
    return { scope, mine, recent };
  });
  const startedAt = found.mine.map((each) => each.at).sort()[0] ?? since;
  const opened = await openedIn(deps, found.scope.sessionId);
  const asked = textArg(args, 'repository');
  const touched = chosen(
    [...new Set([...opened, ...repositoriesOf(found.mine)])],
    repositoriesOf(found.recent),
    asked,
  );
  const places =
    touched.length > 0 || asked === undefined ? touched : await onDisk(deps, asked);
  const repositories = [];
  for (const place of places.slice(0, MOST_REPOSITORIES)) {
    repositories.push(await describeRepository(place, startedAt));
  }
  return {
    ...found.scope,
    commitsSince: startedAt,
    repositories,
    ...(repositories.length === 0
      ? { said: 'No repository was found for this session or by that name.' }
      : {}),
  };
}

/**
 * The repository the session was opened in, which a session that has only run commands and
 * written nothing has no other trace of, and which is where its git status is asked.
 */
async function openedIn(
  deps: SessionToolDeps,
  sessionId: string | null,
): Promise<string[]> {
  if (sessionId === null) return [];
  const cwd = (await new SessionHosts(deps.home).read(sessionId))?.cwd;
  const root = cwd === undefined ? null : repositoryAround(cwd);
  return root === null ? [] : [root];
}

/** The session's own repositories, or the one named, matched by folder name against what was touched lately. */
function chosen(
  mine: readonly string[],
  recent: readonly string[],
  asked: string | undefined,
): string[] {
  if (asked === undefined) return [...mine];
  const wanted = asked.toLowerCase();
  const pool = [...new Set([...mine, ...recent])];
  const exact = pool.filter(
    (each) => each === asked || basename(each).toLowerCase() === wanted,
  );
  return exact.length > 0
    ? exact
    : pool.filter((each) => basename(each).toLowerCase().includes(wanted));
}

/** A named repository no session touched lately, found on the disk rather than reported missing. */
async function onDisk(deps: SessionToolDeps, asked: string): Promise<string[]> {
  if (isAbsolute(asked)) {
    const root = repositoryAround(asked);
    return root === null ? [] : [root];
  }
  // Only a name that matches, since a merely similar one would read out another project's commits.
  const named = repositoryNamed(asked, await knownRepositories(deps), false);
  return named === null ? [] : [named];
}

async function describeRepository(
  place: string,
  since: string,
): Promise<Record<string, unknown>> {
  const git = new NodeGit(place);
  const branch = await git
    .run(['rev-parse', '--abbrev-ref', 'HEAD'])
    .catch(() => 'unknown');
  const log = await git
    .run([
      'log',
      `--since=${since}`,
      `-n`,
      String(MOST_COMMITS),
      '--name-only',
      '--format=%x1e%h%x1f%aI%x1f%s',
    ])
    .catch(() => '');
  const latest = await git
    .run(['log', '-n', String(LATEST_COMMITS), '--format=%h%x1f%aI%x1f%an%x1f%s'])
    .catch(() => '');
  const status = await git.run(['status', '--porcelain=v1']).catch(() => null);
  return {
    repository: place,
    name: basename(place),
    branch,
    commits: commitsIn(log),
    latestCommits: latestIn(latest),
    ...(status === null ? {} : { uncommitted: uncommittedIn(status) }),
  };
}

/** A status line as its state, such as M or ??, and its path, however the output was trimmed. */
const STATUS_LINE = /^\s*(\S{1,2})\s+(.+)$/;

/** What git status lists as not yet committed, each as its state and its path. */
function uncommittedIn(status: string): { total: number; shown: string[] } {
  const lines = status
    .split('\n')
    .map((each) => STATUS_LINE.exec(each))
    .filter((each) => each !== null)
    .map(([, state, path]) => `${state} ${path}`);
  return { total: lines.length, shown: lines.slice(0, MOST_ROWS) };
}

/** git log split on the record separator each commit starts with, its files on the lines after. */
function commitsIn(log: string): Commit[] {
  return log
    .split('\u001e')
    .map((each) => each.trim())
    .filter((each) => each !== '')
    .map((record) => {
      const [head = '', ...files] = record.split('\n');
      const [sha = '', at = '', subject = ''] = head.split('\u001f');
      return { sha, at, subject, files: files.filter((each) => each !== '') };
    });
}

/** One commit a line, newest first, as its short id, time, author and message. */
function latestIn(log: string): LatestCommit[] {
  return log
    .split('\n')
    .filter((each) => each.trim() !== '')
    .map((line) => {
      const [sha = '', at = '', author = '', subject = ''] = line.split('\u001f');
      return { sha, at, author, subject };
    });
}
