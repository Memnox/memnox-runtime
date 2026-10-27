import { readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { MEMNOX_HOME, readJsonFile, SessionHosts, writeJsonFile } from '@memnox/core';

/**
 * Every folder in the person's home by name, so "open the memnox macos folder" finds it however
 * it was said, and the ones they use most, from what they opened and where their agents ran.
 * Names and paths only: nothing inside a folder is read, and none of it leaves this Mac.
 */

const USE_FILE = join('voice', 'folder-use.json');

/** Deep enough for ~/Documents/work/project, where projects live; deeper is inside one. */
const MOST_DEPTH = 4;
/** A home holds a few thousand folders worth naming; past this it is a dump, not a place. */
const MOST_FOLDERS = 6_000;
/** Folders do not move often, and a walk of a home is not free. */
const FRESH_MS = 10 * 60 * 1_000;
/** Enough to remember every folder somebody returns to. */
const MOST_REMEMBERED = 300;

/** Folders nobody opens by name: the system's, media libraries, and what tools build or download. */
const SKIPPED: ReadonlySet<string> = new Set([
  'Library',
  'Applications',
  'Movies',
  'Music',
  'Pictures',
  'Public',
  'node_modules',
  'build',
  'dist',
  'out',
  'target',
  'vendor',
  'Pods',
  'DerivedData',
  'venv',
  '__pycache__',
  'coverage',
]);

export interface Folder {
  name: string;
  path: string;
}

export interface FolderUse {
  path: string;
  /** Opened by the person or worked in by one of their agents. */
  uses: number;
  last: string;
}

let walked: { home: string; at: number; folders: Folder[] } | null = null;

/** Every folder under the home worth naming, walked once and kept for a while. */
export async function homeFolders(
  home: string,
  now: number = Date.now(),
): Promise<Folder[]> {
  if (walked !== null && walked.home === home && now - walked.at < FRESH_MS)
    return walked.folders;
  const folders: Folder[] = [];
  await walk(home, 0, folders);
  walked = { home, at: now, folders };
  return folders;
}

async function walk(dir: string, depth: number, into: Folder[]): Promise<void> {
  if (depth >= MOST_DEPTH || into.length >= MOST_FOLDERS) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  // A repository is a place to open, not a tree to wander: its own folders are code.
  if (depth > 0 && entries.some((each) => each.name === '.git')) return;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name))
      continue;
    if (into.length >= MOST_FOLDERS) return;
    const path = join(dir, entry.name);
    into.push({ name: entry.name, path });
    await walk(path, depth + 1, into);
  }
}

/** A folder name or a spoken phrase as plain words, so "memnox-macos" and "memnox mac OS" meet. */
function spokenWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && word !== 'folder' && word !== 'the');
}

/** How well a folder answers what was said, from 0 for nothing to 1 for its very name. */
export function nameMatch(said: string, folder: Folder, home: string): number {
  const wanted = spokenWords(said).join('');
  if (wanted === '') return 0;
  const name = spokenWords(folder.name).join('');
  // The folder with its parent, so "documents memnox" or "saas runtime" finds it too.
  const withParent = spokenWords(
    relative(home, folder.path).split('/').slice(-2).join(' '),
  ).join('');
  if (name === wanted) return 1;
  if (withParent === wanted) return 0.95;
  if (name.startsWith(wanted) || withParent.endsWith(wanted)) return 0.8;
  // Misheard by a letter or two in every few, like "mem nocks mac os".
  const near = 1 - distance(wanted, name) / Math.max(wanted.length, name.length);
  if (near >= 0.7) return near * 0.85;
  return name.includes(wanted) || wanted.includes(name) ? 0.5 : 0;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** Recent use counts for more, so a folder used daily this week outranks one used a lot last year. */
export function weight(use: FolderUse, now: number): number {
  const days = (now - Date.parse(use.last)) / 86_400_000;
  const fresh = days < 1 ? 1 : days < 7 ? 0.7 : days < 30 ? 0.4 : 0.2;
  return use.uses * fresh;
}

/** The folders they use most: opened through Memnox, and where their agent sessions ran. */
export async function folderUses(
  home: string,
  now: number = Date.now(),
): Promise<FolderUse[]> {
  const kept = (
    await readJsonFile<{ folders?: FolderUse[] }>(join(home, MEMNOX_HOME, USE_FILE))
  )?.folders;
  const uses = new Map<string, FolderUse>();
  for (const each of kept ?? []) uses.set(each.path, { ...each });
  for (const host of await new SessionHosts(home).all().catch(() => [])) {
    if (host.cwd === undefined || host.cwd === home) continue;
    const was = uses.get(host.cwd);
    uses.set(host.cwd, {
      path: host.cwd,
      uses: (was?.uses ?? 0) + 1,
      last: was === undefined || host.seenAt > was.last ? host.seenAt : was.last,
    });
  }
  return [...uses.values()].sort((a, b) => weight(b, now) - weight(a, now));
}

/** Notes one opening, so the folders they return to rise. */
export async function noteFolderUse(
  home: string,
  path: string,
  at: string,
): Promise<void> {
  const file = join(home, MEMNOX_HOME, USE_FILE);
  const kept = (await readJsonFile<{ folders?: FolderUse[] }>(file))?.folders ?? [];
  const was = kept.find((each) => each.path === path);
  const next = [
    { path, uses: (was?.uses ?? 0) + 1, last: at },
    ...kept.filter((each) => each.path !== path),
  ].slice(0, MOST_REMEMBERED);
  await writeJsonFile(file, { folders: next });
}

/** A folder they named that is there: a full path, or one under their home. */
export async function existingFolder(home: string, path: string): Promise<string | null> {
  const full = isAbsolute(path) ? path : resolve(home, path.replace(/^~\/?/, ''));
  const found = await stat(full).catch(() => null);
  return found?.isDirectory() === true ? full : null;
}

/** Close enough to start a session in: a name misheard by a letter or two, never a stretch. */
const FOLDER_MATCH_FLOOR = 0.7;

/** The folder in the home best matching what was said, and whether its very name was said; null when none is close. */
export async function folderNamed(
  home: string,
  said: string,
  now: number = Date.now(),
): Promise<{ path: string; exact: boolean } | null> {
  const best = (await homeFolders(home, now))
    .map((folder) => ({ folder, match: nameMatch(said, folder, home) }))
    .filter((each) => each.match >= FOLDER_MATCH_FLOOR)
    .sort((a, b) => b.match - a.match)[0];
  return best === undefined ? null : { path: best.folder.path, exact: best.match === 1 };
}

/** Whether a folder sits inside the home and outside every hidden folder, such as Memnox's own. */
export function insideHome(home: string, path: string): boolean {
  const within = relative(home, path);
  return (
    within !== '' &&
    !within.startsWith('..') &&
    !isAbsolute(within) &&
    !within.split('/').some((part) => part.startsWith('.'))
  );
}

/** The folder name as said aloud, for the recognizer and the brain. */
export function spokenName(path: string): string {
  return basename(path).replace(/[-_]/g, ' ');
}
