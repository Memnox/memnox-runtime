import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CREDENTIAL_PATHS,
  ENTRY_KIND,
  matchesAny,
  REMOTE_OUTCOME,
  type DaemonRequest,
  type DaemonResponse,
  type EntryKind,
  type FileEntry,
} from '@memnox/core';
import { UNREADABLE } from '../commands/run/untrusted';

/**
 * One folder under the person's home as names, kinds, sizes and dates, so a phone browses the Mac
 * without asking the brain or looking at the screen. Nothing in a file is ever read.
 */

/** Enough for any folder a person browses by hand, and a bound on what one answer carries. */
export const MOST_FILES_LISTED = 500;

const HIDDEN = '.';

function refusal(request: DaemonRequest, reason: string): DaemonResponse {
  return {
    id: request.id,
    ok: false,
    outcome: REMOTE_OUTCOME.REFUSED,
    reason,
    error: reason,
  };
}

/** Where credentials sit, by the runtime's own rules: the credential targets and the keychains. */
function isSecret(home: string, path: string): boolean {
  if (matchesAny(CREDENTIAL_PATHS, path)) return true;
  return UNREADABLE.some((each) => {
    const root = join(home, each);
    return path === root || path.startsWith(`${root}${sep}`);
  });
}

/** A symbolic link is listed as what it points at, and as a file when that is gone. */
async function kindOf(folder: string, entry: Dirent): Promise<EntryKind> {
  if (entry.isDirectory()) return ENTRY_KIND.FOLDER;
  if (!entry.isSymbolicLink()) return ENTRY_KIND.FILE;
  const target = await stat(join(folder, entry.name)).catch(() => null);
  return target?.isDirectory() === true ? ENTRY_KIND.FOLDER : ENTRY_KIND.FILE;
}

/** Folders first, then by name as Finder orders them, with numbers read as numbers. */
function byKindThenName(
  a: { name: string; kind: EntryKind },
  b: { name: string; kind: EntryKind },
): number {
  if (a.kind !== b.kind) return a.kind === ENTRY_KIND.FOLDER ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

async function entryOf(
  folder: string,
  name: string,
  kind: EntryKind,
): Promise<FileEntry> {
  const found = await stat(join(folder, name)).catch(() => null);
  if (found === null) return { name, kind };
  return {
    name,
    kind,
    ...(kind === ENTRY_KIND.FILE ? { bytes: found.size } : {}),
    modified: found.mtime.toISOString(),
  };
}

/** The folder a request names, refused when it resolves outside the home, into a hidden folder or onto a credential. */
export async function filesListAnswer(
  home: string,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  const realHome = await realpath(home);
  const asked = request.path ?? '';
  const folder = await realpath(resolve(realHome, asked)).catch(() => null);
  if (folder === null) return refusal(request, `There is no folder called ${asked}.`);
  const within = relative(realHome, folder);
  if (within.startsWith('..') || isAbsolute(within)) {
    return refusal(request, 'Only folders inside your home folder can be listed.');
  }
  // Never listed, so a phone has no honest way to arrive in one.
  if (within.split(sep).some((part) => part.startsWith(HIDDEN))) {
    return refusal(request, 'Hidden folders are not listed from afar.');
  }
  if (isSecret(realHome, folder)) {
    return refusal(
      request,
      'That folder holds credentials, so it is not listed from afar.',
    );
  }
  if (!(await stat(folder)).isDirectory()) {
    return refusal(request, `${asked} is a file, not a folder.`);
  }
  const shown = (await readdir(folder, { withFileTypes: true })).filter(
    (entry) => !entry.name.startsWith(HIDDEN),
  );
  const kinds = await Promise.all(
    shown.map(async (entry) => ({ name: entry.name, kind: await kindOf(folder, entry) })),
  );
  const first = kinds.sort(byKindThenName).slice(0, MOST_FILES_LISTED);
  const files = await Promise.all(
    first.map((each) => entryOf(folder, each.name, each.kind)),
  );
  return { id: request.id, ok: true, path: within.split(sep).join('/'), files };
}
