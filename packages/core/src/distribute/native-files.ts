import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withoutTrailing } from '../domain/plain-text';

/**
 * Files Memnox writes in an agent's own format, so each agent reads them natively. Every file
 * carries a marker, a file a person wrote is never overwritten, and only files of ours are removed.
 */

/** How a file of ours is told from one a person wrote under the same name, which is kept. */
export const OURS_MARKER = 'memnox: written by memnox, and removed by it';

export const NATIVE_PLACED = {
  WRITTEN: 'written',
  /** Already exactly as it would be written. */
  UNCHANGED: 'unchanged',
  /** A person's file is there, so it is left and nothing is written. */
  KEPT: 'kept',
} as const;

export type NativePlaced = (typeof NATIVE_PLACED)[keyof typeof NATIVE_PLACED];

export interface NativeFile {
  path: string;
  /** Text carries the marker; bytes ride along inside a folder whose marker file decides it. */
  content: string | Uint8Array;
}

/** A folder written as one, such as a skill: its marker file says whose the whole folder is. */
export interface NativeFolder {
  dir: string;
  /** Relative to the folder, and always among `files`. */
  markerFile: string;
  files: { relative: string; content: string | Uint8Array }[];
}

export function isOurs(text: string | Buffer, marker: string = OURS_MARKER): boolean {
  return (typeof text === 'string' ? text : text.toString('utf8')).includes(marker);
}

/** Markdown with the marker as a comment no agent renders. */
export function markdownMarked(text: string, marker: string = OURS_MARKER): string {
  return `${text.trimEnd()}\n\n<!-- ${marker} -->\n`;
}

/** TOML with the marker as its first line. */
export function tomlMarked(text: string, marker: string = OURS_MARKER): string {
  return `# ${marker}\n${text}`;
}

/** Written unless a person's file is in the way; text without the marker could never be removed, so it is refused. */
export async function placeNativeFile(
  file: NativeFile,
  marker: string = OURS_MARKER,
): Promise<NativePlaced> {
  if (typeof file.content === 'string' && !isOurs(file.content, marker))
    throw new Error(
      `${file.path} would be written without the marker that makes it ours`,
    );
  const current = await readOrNull(file.path);
  if (current !== null && sameContent(current, file.content))
    return NATIVE_PLACED.UNCHANGED;
  if (current !== null && !isOurs(current, marker)) return NATIVE_PLACED.KEPT;
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.content);
  return NATIVE_PLACED.WRITTEN;
}

/** Taken out only when it is ours; true when it was. */
export async function removeNativeFile(
  path: string,
  marker: string = OURS_MARKER,
): Promise<boolean> {
  const current = await readOrNull(path);
  if (current === null || !isOurs(current, marker)) return false;
  await rm(path, { force: true });
  return true;
}

/**
 * Every file of the folder written, and any it held from an earlier write and no longer does removed.
 * A folder a person made, with no marker file of ours in it, is left whole.
 */
export async function placeNativeFolder(
  folder: NativeFolder,
  {
    marker = OURS_MARKER,
    previous = [],
  }: { marker?: string; previous?: readonly string[] } = {},
): Promise<NativePlaced> {
  const markerText = await readOrNull(join(folder.dir, folder.markerFile));
  if (markerText === null && (await hasEntries(folder.dir))) return NATIVE_PLACED.KEPT;
  if (markerText !== null && !isOurs(markerText, marker)) return NATIVE_PLACED.KEPT;
  let wrote = false;
  for (const file of folder.files) {
    const path = join(folder.dir, file.relative);
    const current = await readOrNull(path);
    if (current !== null && sameContent(current, file.content)) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    wrote = true;
  }
  const kept = new Set(folder.files.map((file) => file.relative));
  for (const stale of previous.filter((each) => !kept.has(each))) {
    await rm(join(folder.dir, stale), { force: true });
    wrote = true;
  }
  return wrote ? NATIVE_PLACED.WRITTEN : NATIVE_PLACED.UNCHANGED;
}

/** The files of ours taken out, then any folder they leave empty; a person's own files stay. */
export async function removeNativeFolder(
  folder: { dir: string; markerFile: string; files: readonly string[] },
  marker: string = OURS_MARKER,
): Promise<boolean> {
  const markerText = await readOrNull(join(folder.dir, folder.markerFile));
  if (markerText === null || !isOurs(markerText, marker)) return false;
  for (const relative of new Set([...folder.files, folder.markerFile]))
    await rm(join(folder.dir, relative), { force: true });
  await pruneEmpty(folder.dir);
  return true;
}

/** The two lines that fence a block of ours inside a file a person also writes in. */
export interface NativeBlockMarkers {
  begin: string;
  end: string;
}

/** The text with our block taken out, and the blank line it was set apart by; a person's text stays as it was. */
export function withoutNativeBlock(text: string, markers: NativeBlockMarkers): string {
  const start = text.indexOf(markers.begin);
  if (start < 0) return text;
  const stop = text.indexOf(markers.end, start);
  // A begin with no end was cut by hand, so nothing past it is known to be ours.
  if (stop < 0) return text;
  const before = text.slice(0, start).replace(/\n+$/, '');
  const after = text.slice(stop + markers.end.length).replace(/^\n+/, '');
  if (before === '') return after;
  return after === '' ? `${before}\n` : `${before}\n\n${after}`;
}

/** The text with our block in place of any earlier one, at the end, set apart from a person's text by a blank line. */
export function withNativeBlock(
  text: string,
  body: string,
  markers: NativeBlockMarkers,
): string {
  const theirs = withoutTrailing(withoutNativeBlock(text, markers), '\n');
  const block = `${markers.begin}\n${body.trim()}\n${markers.end}\n`;
  return theirs === '' ? block : `${theirs}\n\n${block}`;
}

/**
 * Our block written into a file a person may also keep text in, such as an agent's instructions:
 * only what sits between the markers is ever ours, so their words before and after it stay whole.
 */
export async function placeNativeBlock(
  path: string,
  body: string,
  markers: NativeBlockMarkers,
): Promise<NativePlaced> {
  const current = await readOrNull(path);
  const text = current === null ? '' : current.toString('utf8');
  const next = withNativeBlock(text, body, markers);
  if (next === text) return NATIVE_PLACED.UNCHANGED;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next, 'utf8');
  return NATIVE_PLACED.WRITTEN;
}

/** Our block taken out of the file; a file left empty by it was only ours, so it goes too. True when there was one. */
export async function removeNativeBlock(
  path: string,
  markers: NativeBlockMarkers,
): Promise<boolean> {
  const current = await readOrNull(path);
  if (current === null) return false;
  const text = current.toString('utf8');
  const next = withoutNativeBlock(text, markers);
  if (next === text) return false;
  if (next.trim() === '') await rm(path, { force: true });
  else await writeFile(path, next, 'utf8');
  return true;
}

/** Empty folders removed from the deepest up; one holding anything is left. */
async function pruneEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  // Already gone, or not a folder: nothing to prune.
  if (entries === null) return;
  for (const entry of entries)
    if (entry.isDirectory()) await pruneEmpty(join(dir, entry.name));
  // Not empty is the ordinary answer for a folder a person also keeps files in.
  await rmdir(dir).catch(() => undefined);
}

async function hasEntries(dir: string): Promise<boolean> {
  const entries = await readdir(dir).catch((): string[] => []);
  return entries.length > 0;
}

function sameContent(current: Buffer, wanted: string | Uint8Array): boolean {
  return current.equals(
    typeof wanted === 'string' ? Buffer.from(wanted, 'utf8') : wanted,
  );
}

/** The file's bytes, or null when there is none. */
async function readOrNull(path: string): Promise<Buffer | null> {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path);
  } catch {
    // Unreadable is read as a person's file, since only a file of ours is ever touched.
    return Buffer.alloc(0);
  }
}
