import { isAbsolute, relative } from 'node:path';

import {
  fetchSessionBrief,
  readAccount,
  renderSessionBrief,
  SessionTasks,
  type SessionBriefAsk,
} from '@memnox/core';

import { remoteIdentityOf } from './git-branch';

/**
 * The lines a session starts with about work people have open where it is about to work, and
 * what was said about it, asked of the workspace once. Empty with no account, on any failure,
 * and whenever the workspace has nothing to say, so a session offline starts exactly as before.
 */

/** Asks the workspace for the brief; injected so a test states the answer. */
export type SessionBriefFetch = (ask: SessionBriefAsk) => Promise<unknown>;

interface SessionBriefDeps {
  home: string;
  /** The session a declared task is filed under: `memnox run`'s, or the host's own. */
  sessionId: string;
  cwd: string;
  root: string | null;
  brief?: SessionBriefFetch;
  /** Injected so a test names the remote rather than asking git. */
  remoteOf?: (root: string) => string | undefined;
}

/** Glob segments a declared path may end in; the brief is asked about the folder they sit in. */
const GLOB_TAIL = /(\/\*\*?)+$|\/?\*[^/]*$/;

export async function sessionBriefLine(deps: SessionBriefDeps): Promise<string> {
  const ask = deps.brief ?? (await connectedFetch(deps.home));
  if (ask === null) return '';
  const remote =
    deps.root === null ? undefined : (deps.remoteOf ?? remoteIdentityOf)(deps.root);
  const task = await new SessionTasks(deps.home).read(deps.sessionId).catch(() => null);
  const declared = task === null ? [] : (task.scope.paths ?? []);
  const resources = resourcesOf(declared, deps, remote);
  if (resources.length === 0) return '';
  const pack = await ask({
    resources,
    ...(remote === undefined ? {} : { repository: remote }),
    ...(task === null ? {} : { task: task.statement }),
  }).catch(() => null);
  return pack === null ? '' : renderSessionBrief(pack);
}

/** The live fetch, or null where this machine is in no workspace, so nothing else is read. */
async function connectedFetch(home: string): Promise<SessionBriefFetch | null> {
  const account = await readAccount(home).catch(() => null);
  if (account === null || account.revokedAt !== undefined) return null;
  return (ask) => fetchSessionBrief(home, ask);
}

/**
 * What the session declared it would touch, as repository paths; else the folder it opened in;
 * else the repository as a whole, named by its remote.
 */
function resourcesOf(
  declared: readonly string[],
  deps: SessionBriefDeps,
  remote: string | undefined,
): string[] {
  const paths = declared
    .map((each) => repositoryPath(each, deps.root))
    .filter((each): each is string => each !== null && each !== '');
  if (paths.length > 0) return [...new Set(paths)];
  const here = repositoryPath(deps.cwd, deps.root);
  if (here !== null && here !== '') return [here];
  return remote === undefined ? [] : [remote];
}

/** A declared path or a folder as the repository names it, or null where it lies outside it. */
function repositoryPath(raw: string, root: string | null): string | null {
  const bare = raw.replace(GLOB_TAIL, '');
  if (!isAbsolute(bare)) return bare.replace(/^\.\//, '');
  if (root === null) return null;
  const inside = relative(root, bare);
  return inside.startsWith('..') || isAbsolute(inside) ? null : inside;
}
