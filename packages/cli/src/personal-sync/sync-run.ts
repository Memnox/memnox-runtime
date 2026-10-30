import {
  MOST_SYNC_ITEM_CHARS,
  MOST_SYNC_UPLOAD,
  openSyncItem,
  PERSONAL_SYNC_STATE,
  sealSyncItem,
  syncDigestOf,
  syncItemIdOf,
  syncItemOf,
  syncKeyIdOf,
  syncPlaintextOf,
  SYNC_KIND,
  type SecretStore,
  type SyncItem,
} from '@memnox/core';
import {
  callSync,
  pageSince,
  uploadItems,
  type CloudItem,
  type CloudSend,
  type CloudUpload,
} from '../sync/personal-sync-cloud';
import { applySyncItem, removeSyncItem } from './apply-items';
import { localSyncItems } from './local-items';
import { syncKeyFor } from './key-exchange';
import {
  entryKey,
  readSyncState,
  writeSyncState,
  type PersonalSyncFile,
} from './sync-state';

/**
 * One run of personal sync: read every change the person's other machines sent past this
 * machine's cursor and put each where it is kept here, then seal and send what changed here.
 * Run when the person asks and after a local change, never on a timer.
 */

/** Pages read in one run; with fifty to a page it is past everything one person may keep. */
const MOST_PAGES = 100;

export interface SyncDeps {
  home: string;
  secrets: SecretStore;
  now: () => Date;
  send?: CloudSend;
}

/** What a run read and sent, for the person to hear in a sentence. */
interface Tally {
  received: number;
  sent: number;
  /** Items changed here since they last synced, which a change from elsewhere does not overwrite. */
  editedHere: Set<string>;
}

export async function syncNow(deps: SyncDeps): Promise<PersonalSyncFile> {
  const state = await readSyncState(deps.home);
  const keyed = await syncKeyFor(deps, state);
  if ('state' in keyed) {
    const stood = { ...state, state: keyed.state, said: keyed.said };
    await writeSyncState(deps.home, stood);
    return stood;
  }
  const run = { ...state, skipped: [] };
  const local = await localSyncItems(deps.home);
  const tally: Tally = {
    received: 0,
    sent: 0,
    editedHere: editedSince(keyed.key, run, local),
  };
  const pulled = await pull(deps, keyed.key, run, tally);
  const pushed = pulled === null ? await push(deps, keyed.key, run, tally) : pulled;
  // Something went out under the key, so it stays the person's key whoever registered first.
  if (pushed === null && tally.sent > 0) delete run.keyMadeHere;
  const done =
    pushed === null
      ? {
          ...run,
          state: PERSONAL_SYNC_STATE.READY,
          said: `Synced: ${tally.received} received, ${tally.sent} sent.`,
          lastSyncedAt: deps.now().toISOString(),
          conflicts: await conflictCount(deps, run.conflicts),
        }
      : { ...run, ...pushed };
  await writeSyncState(deps.home, done);
  return done;
}

type Stopped = Pick<PersonalSyncFile, 'state' | 'said'> | null;

async function pull(
  deps: SyncDeps,
  key: Buffer,
  state: PersonalSyncFile,
  tally: Tally,
): Promise<Stopped> {
  const listed = new Set<string>();
  let reset = false;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const answer = await pageSince(deps.home, state.cursor, deps.send);
    if (!answer.ok) return { state: answer.state, said: answer.said };
    // Forgotten deletions or an erasure: read everything again and drop what the listing lacks.
    if (answer.value.reset && !reset) {
      reset = true;
      state.cursor = 0;
      continue;
    }
    for (const item of answer.value.items) {
      listed.add(entryKey(item.kind, item.id));
      // Both changed: this machine's copy is sent as the newest and the cloud keeps the other as a conflict copy.
      if (tally.editedHere.has(entryKey(item.kind, item.id))) continue;
      tally.received += (await received(deps, key, state, item)) ? 1 : 0;
    }
    state.cursor = answer.value.next;
    if (!answer.value.more) break;
  }
  if (reset)
    for (const known of Object.keys(state.entries))
      if (!listed.has(known)) delete state.entries[known];
  return null;
}

/** What stood here when last synced and differs now, or is gone. */
function editedSince(
  key: Buffer,
  state: PersonalSyncFile,
  local: readonly SyncItem[],
): Set<string> {
  const now = new Map(
    local.map((item) => [
      entryKey(item.kind, syncItemIdOf(key, item.kind, item.name)),
      syncDigestOf(item),
    ]),
  );
  return new Set(
    Object.entries(state.entries)
      .filter(([at, entry]) => entry.here && now.get(at) !== entry.digest)
      .map(([at]) => at),
  );
}

/** One change from elsewhere put in place here; false where it was this machine's own or left out. */
async function received(
  deps: SyncDeps,
  key: Buffer,
  state: PersonalSyncFile,
  item: CloudItem,
): Promise<boolean> {
  const at = entryKey(item.kind, item.id);
  const known = state.entries[at];
  if (known !== undefined && known.version >= item.version) return false;
  const place = { home: deps.home, at: deps.now().toISOString() };
  if (item.deleted === true || item.ciphertext === undefined) {
    if (known === undefined) return false;
    const removed = await removeSyncItem(place, known);
    if (removed.said !== undefined) state.skipped.push(removed.said);
    if (removed.here) delete state.entries[at];
    // Still here, waiting on a signature: a tombstone, so the next push does not bring it back.
    else
      state.entries[at] = { ...known, version: item.version, here: false, deleted: true };
    return true;
  }
  const opened = openedItem(key, item);
  if (opened === undefined) {
    state.skipped.push(
      'An item sealed under another sync key, or not by your machines, was left out.',
    );
    return false;
  }
  if (opened.kind === SYNC_KIND.PROJECTS && !state.openedElsewhere.includes(opened.name))
    state.openedElsewhere.push(opened.name);
  const applied = await applySyncItem(place, opened);
  state.entries[at] = {
    kind: opened.kind,
    name: opened.name,
    version: item.version,
    digest: syncDigestOf(opened),
    here: applied.here,
    ...(applied.here || applied.said === undefined ? {} : { said: applied.said }),
  };
  return true;
}

function openedItem(key: Buffer, item: CloudItem): SyncItem | undefined {
  if (item.keyId !== syncKeyIdOf(key) || item.ciphertext === undefined) return undefined;
  const text = openSyncItem(key, {
    kind: item.kind,
    id: item.id,
    ciphertext: item.ciphertext,
  });
  const opened = text === undefined ? undefined : syncItemOf(text);
  // The kind sealed inside must be the kind it was filed under, which the sealing bound in as well.
  return opened !== undefined && opened.kind === item.kind ? opened : undefined;
}

async function push(
  deps: SyncDeps,
  key: Buffer,
  state: PersonalSyncFile,
  tally: Tally,
): Promise<Stopped> {
  const local = await localSyncItems(deps.home);
  const uploads = [...changedHere(key, state, local), ...goneHere(key, state, local)];
  state.openedElsewhere = state.openedElsewhere.filter(
    (name) =>
      !local.some((item) => item.kind === SYNC_KIND.PROJECTS && item.name === name),
  );
  for (let at = 0; at < uploads.length; at += MOST_SYNC_UPLOAD) {
    const batch = uploads.slice(at, at + MOST_SYNC_UPLOAD);
    const answer = await uploadItems(
      deps.home,
      batch.map((each) => each.upload),
      deps.send,
    );
    if (!answer.ok) return { state: answer.state, said: answer.said };
    for (const result of answer.value.items) {
      const sent = batch.find(
        (each) => each.upload.id === result.id && each.upload.kind === result.kind,
      );
      if (sent === undefined) continue;
      const entry = entryKey(result.kind, result.id);
      if (sent.item === undefined) delete state.entries[entry];
      else
        state.entries[entry] = {
          kind: sent.item.kind,
          name: sent.item.name,
          version: result.version,
          digest: syncDigestOf(sent.item),
          here: true,
        };
      tally.sent += 1;
    }
  }
  return null;
}

/** An upload, with the item it carries; none on a deletion. */
interface Outgoing {
  upload: CloudUpload;
  item?: SyncItem;
}

function changedHere(
  key: Buffer,
  state: PersonalSyncFile,
  local: readonly SyncItem[],
): Outgoing[] {
  const keyId = syncKeyIdOf(key);
  return local.flatMap((item) => {
    const id = syncItemIdOf(key, item.kind, item.name);
    const known = state.entries[entryKey(item.kind, id)];
    const digest = syncDigestOf(item);
    if (known !== undefined && known.digest === digest) {
      // The very copy another machine deleted, waiting here to go: sending it would undo the deletion.
      if (known.deleted === true) return [];
      known.here = true;
      delete known.said;
      return [];
    }
    // A change from elsewhere still waiting on a signature here: this machine's older copy must not win.
    if (known !== undefined && !known.here && known.deleted !== true) return [];
    const ciphertext = sealSyncItem(key, {
      kind: item.kind,
      id,
      plaintext: syncPlaintextOf(item),
    });
    if (ciphertext.length > MOST_SYNC_ITEM_CHARS) {
      state.skipped.push(
        `${item.name} is too large to sync, so it stays on this machine.`,
      );
      return [];
    }
    const upload = {
      kind: item.kind,
      id,
      baseVersion: known === undefined ? 0 : known.version,
      keyId,
      ciphertext,
    };
    return [{ upload, item }];
  });
}

/** What stood here when last synced and is gone now, sent as a deletion. */
function goneHere(
  key: Buffer,
  state: PersonalSyncFile,
  local: readonly SyncItem[],
): Outgoing[] {
  const present = new Set(
    local.map((item) => entryKey(item.kind, syncItemIdOf(key, item.kind, item.name))),
  );
  const keyId = syncKeyIdOf(key);
  // A tombstone is done once its copy is gone here too.
  for (const [at, entry] of Object.entries(state.entries))
    if (entry.deleted === true && !present.has(at)) delete state.entries[at];
  return Object.entries(state.entries).flatMap(([at, entry]) => {
    if (!entry.here || present.has(at)) return [];
    const id = at.slice(entry.kind.length + 1);
    return [
      {
        upload: {
          kind: entry.kind,
          id,
          baseVersion: entry.version,
          keyId,
          deleted: true as const,
        },
      },
    ];
  });
}

/** How many conflict copies the cloud keeps for the person, read from bookkeeping alone. */
async function conflictCount(deps: SyncDeps, before: number): Promise<number> {
  const summary = await callSync<{ conflicts?: unknown }>(
    deps.home,
    { method: 'GET', path: '/summary' },
    deps.send,
  );
  if (!summary.ok || typeof summary.value.conflicts !== 'number') return before;
  return summary.value.conflicts;
}
