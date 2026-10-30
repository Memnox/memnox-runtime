import { join } from 'node:path';
import {
  MEMNOX_HOME,
  readJsonFile,
  writeJsonFile,
  type PersonalSyncState,
  type SyncKind,
} from '@memnox/core';

/**
 * What this machine remembers of personal sync, beside the Memnox home and never sent: where it
 * read up to, and for each item the version it last saw and what it was, so only a change is sent.
 */

const STATE_FILE = 'personal-sync.json';

/** One item as last synced, keyed by kind and id. */
export interface SyncedEntry {
  kind: SyncKind;
  name: string;
  /** The version Memnox Cloud holds, which the next upload names as the one it started from. */
  version: number;
  /** The item as it stood when last synced, so an unchanged one is not sent again. */
  digest: string;
  /** It stands on this machine as synced, so its going away here is a deletion to send. */
  here: boolean;
  /** Why it does not stand here yet, while it waits: in the Skills Hub, or on a signature. */
  said?: string;
}

export interface PersonalSyncFile {
  cursor: number;
  lastSyncedAt?: string;
  /** The exchange public key Memnox Cloud holds for this machine, so it is registered once. */
  registeredKey?: string;
  /** Where sync stood after the last run, and why, for a screen read with no network. */
  state?: PersonalSyncState;
  said?: string;
  entries: Record<string, SyncedEntry>;
  skipped: string[];
  openedElsewhere: string[];
  conflicts: number;
}

function syncStatePathFor(home: string): string {
  return join(home, MEMNOX_HOME, STATE_FILE);
}

export function entryKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export async function readSyncState(home: string): Promise<PersonalSyncFile> {
  const read = await readJsonFile<Partial<PersonalSyncFile>>(syncStatePathFor(home));
  return {
    cursor: typeof read?.cursor === 'number' ? read.cursor : 0,
    ...(read?.lastSyncedAt === undefined ? {} : { lastSyncedAt: read.lastSyncedAt }),
    ...(read?.registeredKey === undefined ? {} : { registeredKey: read.registeredKey }),
    ...(read?.state === undefined ? {} : { state: read.state }),
    ...(read?.said === undefined ? {} : { said: read.said }),
    entries: read?.entries ?? {},
    skipped: read?.skipped ?? [],
    openedElsewhere: read?.openedElsewhere ?? [],
    conflicts: read?.conflicts ?? 0,
  };
}

export async function writeSyncState(
  home: string,
  state: PersonalSyncFile,
): Promise<void> {
  await writeJsonFile(syncStatePathFor(home), state);
}
