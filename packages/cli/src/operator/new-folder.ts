import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { existingFolder, folderNamed, insideHome } from './folders';

/**
 * A new folder the person named out loud, made inside their home so a session can start in it.
 * It is only ever one new, empty folder: nothing is moved, overwritten or made anywhere hidden.
 */

/** A folder name said in one breath, never a path. */
const MOST_NAME_CHARS = 80;
/** Where a folder goes when they name no place, the one most people keep their work in. */
const DEFAULT_PARENT = 'Documents';

type NewFolder = { path: string; created: boolean } | { why: string };

/** The folder made, or the one already there by that name, or why neither could be. */
export async function createFolder(
  home: string,
  name: string,
  within?: string,
): Promise<NewFolder> {
  const clean = name
    .replace(/[/:\\\0]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean === '' || clean.startsWith('.') || clean.length > MOST_NAME_CHARS)
    return { why: 'that is not a name a folder can have' };
  const parent = await parentFor(home, within);
  if (parent === null)
    return { why: `no folder called ${within ?? DEFAULT_PARENT} to put it in` };
  const path = join(parent, clean);
  if (!insideHome(home, path)) return { why: 'folders are only made inside your home' };
  const there = await stat(path).catch(() => null);
  if (there?.isDirectory() === true) return { path, created: false };
  if (there !== null) return { why: `${clean} is already a file there` };
  await mkdir(path);
  return { path, created: true };
}

/** The place they named, by path or by name, or Documents, or the home itself. */
async function parentFor(
  home: string,
  within: string | undefined,
): Promise<string | null> {
  if (within === undefined || within.trim() === '') {
    return (await existingFolder(home, DEFAULT_PARENT)) ?? home;
  }
  if (isAbsolute(within) || within.startsWith('~')) {
    const path = await existingFolder(home, within);
    return path !== null && (path === home || insideHome(home, path)) ? path : null;
  }
  return (await folderNamed(home, within))?.path ?? null;
}
