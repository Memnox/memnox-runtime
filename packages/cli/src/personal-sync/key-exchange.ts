import {
  envelopeSender,
  HTTP,
  minutesToMs,
  newSyncKey,
  openEnvelope,
  pairFingerprint,
  PERSONAL_SYNC_STATE,
  PROPOSAL_KIND,
  Proposals,
  readAccount,
  sealEnvelope,
  syncKeyIdOf,
  type PersonalSyncMachine,
  type PersonalSyncState,
  type ProposedChange,
} from '@memnox/core';
import {
  callSync,
  type CloudMachineKey,
  type SyncAnswer,
} from '../sync/personal-sync-cloud';
import { dropSyncKey, exchangeKeys, keepSyncKey, readSyncKey } from './sync-key';
import type { SyncDeps } from './sync-run';
import { readSyncState, writeSyncState, type PersonalSyncFile } from './sync-state';

/**
 * How the sync key reaches each of the person's machines. The first makes it; every other registers
 * an X25519 key and waits, and the key is sealed to it only once the person compares the fingerprint
 * both machines show and signs on each. Never automatic, since the comparison is what keeps the cloud out.
 */

/** Who the ledger names as having proposed a key moving. */
const PROPOSED_BY = 'agt_memnox-personal-sync';
/** Long enough to walk to the other machine and compare. */
const PROPOSAL_TTL_MS = minutesToMs(10);

type KeyDeps = SyncDeps;

type Stood = { state?: PersonalSyncState; said: string };

/** The key to sync with, made here where this is the person's first machine, or where sync stands without one. */
export async function syncKeyFor(
  deps: KeyDeps,
  state: PersonalSyncFile,
): Promise<{ key: Buffer } | { state: PersonalSyncState; said: string }> {
  const registered = await registerHere(deps, state);
  if (registered !== null) return stoodAs(registered);
  const held = await heldKey(deps, state);
  if ('said' in held) return stoodAs(held);
  if (held.key !== undefined) return { key: held.key };
  const arrived = await arrivedFingerprint(deps);
  if (!arrived.ok) return stoodAs(arrived);
  if (arrived.value !== undefined)
    return {
      state: PERSONAL_SYNC_STATE.KEY_ARRIVED,
      said: `Your sync key arrived from another of your machines. Check that both show ${arrived.value}, then accept it here.`,
    };
  const first = await isFirstMachine(deps);
  if (!first.ok) return stoodAs(first);
  if (!first.value)
    return {
      state: PERSONAL_SYNC_STATE.WAITING_FOR_KEY,
      said: 'Your sync key is on another of your machines. Offer it to this one there, comparing the fingerprint both show.',
    };
  const key = newSyncKey();
  await keepSyncKey(deps.secrets, key);
  state.keyMadeHere = true;
  return { key };
}

/**
 * The key this machine holds, unless it made that key and another of the person's machines
 * registered earlier: then this one lets it go before anything is sealed under it and waits for
 * the earlier machine's, so two machines starting at once settle on one key.
 */
async function heldKey(
  deps: KeyDeps,
  state: PersonalSyncFile,
): Promise<{ key?: Buffer } | Stood> {
  const held = await readSyncKey(deps.secrets);
  if (held === undefined || state.keyMadeHere !== true) return { key: held };
  const first = await registeredFirst(deps);
  if (!first.ok) return first;
  if (first.value) return { key: held };
  await dropSyncKey(deps.secrets);
  delete state.keyMadeHere;
  return {};
}

/** Oldest registration first, by machine id between two at the same instant, so every machine orders alike. */
function byRegistration(one: CloudMachineKey, two: CloudMachineKey): number {
  if (one.updatedAt !== two.updatedAt) return one.updatedAt < two.updatedAt ? -1 : 1;
  if (one.machineId === two.machineId) return 0;
  return one.machineId < two.machineId ? -1 : 1;
}

/**
 * Whether this machine registered before every other of the person's machines no key was sealed
 * to. Each machine registers before it asks, so two asking at once read the same order.
 */
async function registeredFirst(deps: KeyDeps): Promise<SyncAnswer<boolean>> {
  const listed = await callSync<{ machines?: CloudMachineKey[] }>(
    deps.home,
    { method: 'GET', path: '/keys' },
    deps.send,
  );
  if (!listed.ok) return listed;
  const account = await readAccount(deps.home);
  const [first] = (listed.value.machines ?? [])
    .filter((machine) => machine.envelope === undefined)
    .sort(byRegistration);
  return {
    ok: true,
    value:
      first !== undefined && account !== null && first.machineId === account.machineId,
  };
}

function stoodAs(stood: Stood): { state: PersonalSyncState; said: string } {
  return { state: stood.state ?? PERSONAL_SYNC_STATE.READY, said: stood.said };
}

/** This machine's exchange key, registered once; a new key drops the envelope sealed to the old one. */
async function registerHere(
  deps: KeyDeps,
  state: PersonalSyncFile,
): Promise<Stood | null> {
  const mine = await exchangeKeys(deps.secrets);
  if (state.registeredKey === mine.publicKey) return null;
  const answer = await callSync(
    deps.home,
    { method: 'PUT', path: '/keys/mine', body: { publicKey: mine.publicKey } },
    deps.send,
  );
  if (!answer.ok) return answer;
  state.registeredKey = mine.publicKey;
  return null;
}

/** First where nothing was ever synced and this machine registered before the others still waiting. */
async function isFirstMachine(deps: KeyDeps): Promise<SyncAnswer<boolean>> {
  const summary = await callSync<{ newestSeq?: number }>(
    deps.home,
    { method: 'GET', path: '/summary' },
    deps.send,
  );
  if (!summary.ok) return summary;
  if ((summary.value.newestSeq ?? 0) !== 0) return { ok: true, value: false };
  return registeredFirst(deps);
}

/** The fingerprint of a key sealed to this machine and waiting, or undefined where none waits. */
export async function arrivedFingerprint(
  deps: KeyDeps,
): Promise<SyncAnswer<string | undefined>> {
  const row = await callSync<CloudMachineKey>(
    deps.home,
    { method: 'GET', path: '/keys/mine' },
    deps.send,
  );
  // Not registered yet is nothing sealed to it yet.
  if (!row.ok)
    return row.status === HTTP.NOT_FOUND ? { ok: true, value: undefined } : row;
  const envelope = row.value.envelope;
  const sender = envelope === undefined ? undefined : envelopeSender(envelope);
  if (sender === undefined) return { ok: true, value: undefined };
  const mine = await exchangeKeys(deps.secrets);
  return { ok: true, value: pairFingerprint(mine.publicKey, sender) };
}

/** The person's other machines and the fingerprint each pairs with this one under, for the one holding the key. */
export async function waitingMachines(
  deps: KeyDeps,
): Promise<SyncAnswer<PersonalSyncMachine[]>> {
  const key = await readSyncKey(deps.secrets);
  if (key === undefined) return { ok: true, value: [] };
  const listed = await callSync<{ machines?: CloudMachineKey[] }>(
    deps.home,
    { method: 'GET', path: '/keys' },
    deps.send,
  );
  if (!listed.ok) return listed;
  const account = await readAccount(deps.home);
  const mine = await exchangeKeys(deps.secrets);
  const keyId = syncKeyIdOf(key);
  return {
    ok: true,
    value: (listed.value.machines ?? [])
      .filter((machine) => machine.machineId !== account?.machineId)
      .map((machine) => ({
        machineId: machine.machineId,
        fingerprint: pairFingerprint(mine.publicKey, machine.publicKey),
        sealed: machine.envelope !== undefined && machine.keyId === keyId,
      })),
  };
}

function sameFingerprint(one: string, two: string): boolean {
  return one.replace(/\s+/g, '') === two.replace(/\s+/g, '');
}

/** A proposal to seal the key to one waiting machine, raised only where the fingerprint the person compared is the one shown. */
export async function proposeOffer(
  deps: KeyDeps,
  input: { machineId: string; fingerprint: string },
): Promise<{ proposed: string } | { refused: string }> {
  const yielded = await givesWay(deps);
  if (yielded !== null) return { refused: yielded };
  if ((await readSyncKey(deps.secrets)) === undefined)
    return { refused: 'This machine holds no sync key to offer.' };
  const listed = await callSync<{ machines?: CloudMachineKey[] }>(
    deps.home,
    { method: 'GET', path: '/keys' },
    deps.send,
  );
  if (!listed.ok) return { refused: listed.said };
  const machine = (listed.value.machines ?? []).find(
    (each) => each.machineId === input.machineId,
  );
  if (machine === undefined)
    return {
      refused: `${input.machineId} is not one of your machines waiting for the key.`,
    };
  const mine = await exchangeKeys(deps.secrets);
  const fingerprint = pairFingerprint(mine.publicKey, machine.publicKey);
  if (!sameFingerprint(fingerprint, input.fingerprint))
    return {
      refused: 'That is not the fingerprint this machine shows, so the key stays here.',
    };
  return propose(
    deps,
    {
      kind: PROPOSAL_KIND.PERSONAL_SYNC_KEY,
      fingerprint,
      seal: { machineId: machine.machineId, publicKey: machine.publicKey },
    },
    `Give your sync key to ${machine.machineId}, which shows ${fingerprint}`,
  );
}

/** A proposal to take the key sealed to this machine, raised only where the person compared the same fingerprint. */
export async function proposeAccept(
  deps: KeyDeps,
  fingerprint: string,
): Promise<{ proposed: string } | { refused: string }> {
  const row = await callSync<CloudMachineKey>(
    deps.home,
    { method: 'GET', path: '/keys/mine' },
    deps.send,
  );
  if (!row.ok) return { refused: row.said };
  const { envelope, keyId } = row.value;
  const sender = envelope === undefined ? undefined : envelopeSender(envelope);
  if (envelope === undefined || keyId === undefined || sender === undefined)
    return { refused: 'No sync key has been offered to this machine yet.' };
  const mine = await exchangeKeys(deps.secrets);
  const shown = pairFingerprint(mine.publicKey, sender);
  if (!sameFingerprint(shown, fingerprint))
    return {
      refused: 'That is not the fingerprint this machine shows, so the key is not taken.',
    };
  return propose(
    deps,
    {
      kind: PROPOSAL_KIND.PERSONAL_SYNC_KEY,
      fingerprint: shown,
      open: { envelope, keyId },
    },
    `Take the sync key your other machine offered, which shows ${shown}`,
  );
}

async function propose(
  deps: KeyDeps,
  change: ProposedChange,
  rationale: string,
): Promise<{ proposed: string }> {
  const proposal = await new Proposals(deps.home).propose({
    change,
    rationale,
    proposedBy: PROPOSED_BY,
    at: deps.now().toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { proposed: proposal.id };
}

/** A signed key move carried out, each fingerprint worked out again so a hand written proposal moves nothing. */
export async function carryOutKeyMove(
  deps: KeyDeps,
  change: Extract<ProposedChange, { kind: typeof PROPOSAL_KIND.PERSONAL_SYNC_KEY }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mine = await exchangeKeys(deps.secrets);
  if (change.seal !== undefined) {
    const yielded = await givesWay(deps);
    if (yielded !== null) return { ok: false, error: yielded };
    const key = await readSyncKey(deps.secrets);
    if (key === undefined) return { ok: false, error: 'this machine holds no sync key' };
    if (
      !sameFingerprint(
        pairFingerprint(mine.publicKey, change.seal.publicKey),
        change.fingerprint,
      )
    )
      return { ok: false, error: 'the fingerprint no longer matches' };
    const sealed = sealEnvelope({
      syncKey: key,
      sender: mine,
      receiver: change.seal.publicKey,
    });
    const path = `/keys/${encodeURIComponent(change.seal.machineId)}/envelope`;
    const put = await callSync(
      deps.home,
      { method: 'PUT', path, body: sealed },
      deps.send,
    );
    if (!put.ok) return { ok: false, error: put.said };
    await keyWentOut(deps.home);
    return { ok: true };
  }
  if (change.open === undefined) return { ok: false, error: 'the proposal moves no key' };
  const sender = envelopeSender(change.open.envelope);
  if (
    sender === undefined ||
    !sameFingerprint(pairFingerprint(mine.publicKey, sender), change.fingerprint)
  )
    return { ok: false, error: 'the fingerprint no longer matches' };
  const key = openEnvelope({ ...change.open, receiver: mine });
  if (key === undefined)
    return { ok: false, error: 'the key was not sealed to this machine' };
  await keepSyncKey(deps.secrets, key);
  return { ok: true };
}

/** Why a key made here may not go out, where an earlier machine's key replaced it; null where it may. */
async function givesWay(deps: KeyDeps): Promise<string | null> {
  const state = await readSyncState(deps.home);
  if (state.keyMadeHere !== true) return null;
  const held = await heldKey(deps, state);
  await writeSyncState(deps.home, state);
  if ('said' in held) return held.said;
  return held.key === undefined
    ? 'Another of your machines registered first, so its key is the one to share, and this machine let its own go and waits for it.'
    : null;
}

/** Something was sealed under the key made here, so it stays the person's key from now on. */
async function keyWentOut(home: string): Promise<void> {
  const state = await readSyncState(home);
  if (state.keyMadeHere !== true) return;
  delete state.keyMadeHere;
  await writeSyncState(home, state);
}
