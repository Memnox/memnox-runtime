import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { SessionHosts } from '@memnox/core';
import { mainCheckoutOf } from './main-checkout';
import type { SessionToolDeps } from './read-tools';

/**
 * Finding the repository the person named out loud: every one on this Mac a session could start
 * in, and the one whose name sounds like what the recognizer heard.
 */

/**
 * Every repository a session has run in, the repositories beside them, and every one in the
 * folders people keep code in, so a project nobody has opened with an agent yet is still found.
 */
export async function knownRepositories(deps: SessionToolDeps): Promise<string[]> {
  const roots = new Set<string>(repositoriesUnder(deps.home));
  for (const host of await new SessionHosts(deps.home).all()) {
    if (host.cwd !== undefined && isAbsolute(host.cwd))
      roots.add(mainCheckoutOf(host.cwd));
  }
  for (const root of [...roots]) {
    for (const sibling of repositoriesIn(dirname(root))) roots.add(sibling);
  }
  return [...roots].filter((each) => existsSync(join(each, '.git')));
}

/** Where people keep code, under their home folder. */
const CODE_FOLDERS: readonly string[] = [
  'Documents',
  'Developer',
  'Projects',
  'projects',
  'Code',
  'code',
  'src',
  'dev',
  'repos',
  'workspace',
  'github',
  'GitHub',
  'Desktop',
  'Sites',
  'work',
];

/** Deep enough for ~/Documents/company/project, shallow enough to answer while they wait. */
const CODE_DEPTH = 3;
/** A bound on the folders read, so a home full of photos never stalls an answer. */
const MOST_FOLDERS_READ = 3_000;
/** Never a repository anyone means, and often enormous. */
const SKIPPED = new Set(['node_modules', 'Library', 'vendor', 'build', 'dist']);

function repositoriesUnder(home: string): string[] {
  const found: string[] = [];
  let read = 0;
  const walk = (folder: string, depth: number): void => {
    if (read >= MOST_FOLDERS_READ) return;
    read += 1;
    let entries: Dirent[];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      // An unreadable folder has no repositories anyone can be sent to.
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name))
        continue;
      const path = join(folder, entry.name);
      if (existsSync(join(path, '.git'))) found.push(path);
      else if (depth < CODE_DEPTH) walk(path, depth + 1);
    }
  };
  for (const folder of CODE_FOLDERS) walk(join(home, folder), 1);
  return found;
}

function repositoriesIn(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((each) => each.isDirectory() && existsSync(join(folder, each.name, '.git')))
      .map((each) => join(folder, each.name));
  } catch {
    // An unreadable folder has no repositories anyone can be sent to.
    return [];
  }
}

/**
 * The repository whose name sounds like what was said: "memnox cloud" is memnox-cloud, and
 * "my locks runtime", which is how a recognizer hears it, is still memnox-runtime, because
 * runtime names only one of them.
 */
export function repositoryNamed(
  said: string,
  known: readonly string[],
  nearNames = true,
): string | null {
  const wanted = spoken(said);
  if (wanted === '') return null;
  const byName = known.map((each) => ({ path: each, name: spoken(basename(each)) }));
  const exact =
    byName.find((each) => each.name === wanted) ??
    byName.find((each) => each.name.includes(wanted));
  if (exact !== undefined) return exact.path;
  const distinctive = said
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .map((word) => byName.filter((each) => each.name.includes(word)))
    .find((matches) => matches.length === 1)?.[0];
  if (distinctive !== undefined) return distinctive.path;
  if (!nearNames) return null;
  const closest = byName
    .map((each) => ({ ...each, likeness: likeness(wanted, each.name) }))
    .sort((a, b) => b.likeness - a.likeness)[0];
  return closest !== undefined && closest.likeness >= CLOSE_ENOUGH ? closest.path : null;
}

/** How alike two spellings are, from nothing to the same, by the edits between them. */
function likeness(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editsBetween(a, b) / longest;
}

/** Close enough that a misheard name is the one meant, far enough that a different project is not. */
const CLOSE_ENOUGH = 0.6;

function editsBetween(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, swap));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** A name as it sounds, so spacing, dashes and case never decide a match. */
export function spoken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
