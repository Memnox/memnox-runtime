import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { runGit, secondsToMs } from '@memnox/core';

/**
 * What a repository's git says about a config file Memnox would write in it: whether it is tracked,
 * so left alone, and a marked block in `.git/info/exclude` so a file Memnox writes never shows as a change.
 */

const GIT_TIMEOUT_MS = secondsToMs(2);

export const EXCLUDE_BEGIN =
  '# >>> memnox: config files Memnox wrote for this machine >>>';
export const EXCLUDE_END = '# <<< memnox <<<';

/** Whether Memnox may write a file in a repository, as git answers for it. */
export const REPO_FILE = {
  /** Untracked, absent, or in no repository at all. */
  FREE: 'free',
  TRACKED: 'tracked',
  /** A repository whose git could not answer, which is treated as tracked. */
  UNKNOWN: 'unknown',
} as const;

export type RepoFileState = (typeof REPO_FILE)[keyof typeof REPO_FILE];

/** A repository as the config writer needs it: none, or its top folder and its exclude file. */
interface Repository {
  top: string;
  exclude: string;
}

/** Null for a folder in no repository; undefined for one whose git would not answer. */
async function repositoryOf(root: string): Promise<Repository | null | undefined> {
  const top = await runGit(['rev-parse', '--show-toplevel'], root, GIT_TIMEOUT_MS);
  const exclude = await runGit(
    ['rev-parse', '--git-path', 'info/exclude'],
    root,
    GIT_TIMEOUT_MS,
  );
  if (top !== null && exclude !== null)
    return { top: top.trim(), exclude: resolve(root, exclude.trim()) };
  return existsSync(join(root, '.git')) ? undefined : null;
}

/** Fails closed: a repository whose git cannot say is one whose files are not written. */
export async function repoFileState(root: string, path: string): Promise<RepoFileState> {
  const repository = await repositoryOf(root);
  if (repository === null) return REPO_FILE.FREE;
  if (repository === undefined) return REPO_FILE.UNKNOWN;
  // Relative to the root, since git names its folders through any symlink the root was reached by.
  const listed = await runGit(
    ['ls-files', '--', relative(root, path)],
    root,
    GIT_TIMEOUT_MS,
  );
  if (listed === null) return REPO_FILE.UNKNOWN;
  return listed.trim() === '' ? REPO_FILE.FREE : REPO_FILE.TRACKED;
}

/** The file named in the repository's exclude block once, or taken out of it; a folder in no repository is left. */
export async function markExcluded(
  root: string,
  path: string,
  excluded: boolean,
): Promise<void> {
  const repository = await repositoryOf(root);
  if (repository === null || repository === undefined) return;
  const inTop = join(await realpath(root), relative(root, path));
  const entry = `/${relative(repository.top, inTop).split(sep).join('/')}`;
  const raw = existsSync(repository.exclude)
    ? await readFile(repository.exclude, 'utf8')
    : '';
  const { outside, entries } = splitBlock(raw);
  const next = excluded
    ? [...new Set([...entries, entry])]
    : entries.filter((each) => each !== entry);
  if (next.length === entries.length && next.every((each, at) => each === entries[at]))
    return;
  await mkdir(dirname(repository.exclude), { recursive: true });
  await writeFile(repository.exclude, joinBlock(outside, next), 'utf8');
}

/** The person's lines outside the markers, kept as they are, and the entries inside them. */
export function splitBlock(raw: string): { outside: string; entries: string[] } {
  const from = raw.indexOf(EXCLUDE_BEGIN);
  const to = from === -1 ? -1 : raw.indexOf(EXCLUDE_END, from);
  if (from === -1 || to === -1) return { outside: raw, entries: [] };
  const inside = raw.slice(from + EXCLUDE_BEGIN.length, to);
  const after = raw.slice(to + EXCLUDE_END.length).replace(/^\n/, '');
  return {
    outside: `${raw.slice(0, from)}${after}`,
    entries: inside.split('\n').filter((line) => line.trim() !== ''),
  };
}

/** No entries is no block at all, so removing the last file leaves the person's file as it was. */
function joinBlock(outside: string, entries: readonly string[]): string {
  if (entries.length === 0) return outside;
  const lead = outside === '' || outside.endsWith('\n') ? outside : `${outside}\n`;
  return `${lead}${[EXCLUDE_BEGIN, ...entries, EXCLUDE_END].join('\n')}\n`;
}
