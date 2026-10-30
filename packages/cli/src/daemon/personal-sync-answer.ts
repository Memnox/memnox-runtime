import {
  MCP_HUB_METHOD,
  MEMORY_METHOD,
  nodeSecretStore,
  openSyncItem,
  PERSONAL_SYNC_METHOD,
  PERSONAL_SYNC_STATE,
  POLICY_METHOD,
  PROJECTS_METHOD,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  readAccount,
  SKILLS_METHOD,
  SYNC_KEEP,
  SYNC_KIND,
  syncItemOf,
  syncKeyIdOf,
  syncPlaintextOf,
  type DaemonRequest,
  type DaemonResponse,
  type PersonalSyncConflict,
  type PersonalSyncStatus,
  type ProposedChange,
  type SyncItem,
} from '@memnox/core';
import { applySyncItem } from '../personal-sync/apply-items';
import {
  arrivedFingerprint,
  carryOutKeyMove,
  proposeAccept,
  proposeOffer,
  waitingMachines,
} from '../personal-sync/key-exchange';
import { localSyncItems } from '../personal-sync/local-items';
import { readSyncKey } from '../personal-sync/sync-key';
import { syncNow, type SyncDeps } from '../personal-sync/sync-run';
import { readSyncState, type PersonalSyncFile } from '../personal-sync/sync-state';
import { callSync, type CloudConflict } from '../sync/personal-sync-cloud';

/**
 * The personal sync methods. Syncing and reading run here; the key moves only as a proposal the
 * Mac signs, after the person compared the fingerprint both machines show, and never from a phone.
 */

const PERSONAL_SYNC_METHODS: readonly string[] = Object.values(PERSONAL_SYNC_METHOD);

export function isPersonalSyncMethod(method: string): boolean {
  return PERSONAL_SYNC_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

/** The daemon's own: the OS secret store and the clock; a test hands in its own. */
export function syncDepsFor(home: string): SyncDeps {
  return { home, secrets: nodeSecretStore(home), now: () => new Date() };
}

export async function personalSyncAnswer(
  request: DaemonRequest,
  deps: SyncDeps,
): Promise<DaemonResponse> {
  const answered = await answerOf(request, deps).catch((err: unknown): Answered => {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: reason, reason };
  });
  return { id: request.id, ...answered };
}

async function answerOf(request: DaemonRequest, deps: SyncDeps): Promise<Answered> {
  switch (request.method) {
    case PERSONAL_SYNC_METHOD.PERSONAL_SYNC_NOW:
      await syncInTurn(deps);
      return { ok: true, personalSync: await statusOf(deps) };
    case PERSONAL_SYNC_METHOD.PERSONAL_SYNC_CONFLICTS:
      return conflictsAnswer(deps);
    case PERSONAL_SYNC_METHOD.PERSONAL_SYNC_RESOLVE:
      return resolveAnswer(request, deps);
    case PERSONAL_SYNC_METHOD.PERSONAL_SYNC_KEY_OFFER:
      if (request.syncMachineId === undefined || request.syncFingerprint === undefined)
        return { ok: true, personalSync: await statusOf(deps) };
      return proposedAnswer(
        await proposeOffer(deps, {
          machineId: request.syncMachineId,
          fingerprint: request.syncFingerprint,
        }),
        deps,
      );
    case PERSONAL_SYNC_METHOD.PERSONAL_SYNC_KEY_ACCEPT:
      if (request.syncFingerprint === undefined)
        return { ok: true, personalSync: await statusOf(deps) };
      return proposedAnswer(await proposeAccept(deps, request.syncFingerprint), deps);
    default:
      return { ok: true, personalSync: await statusOf(deps) };
  }
}

async function proposedAnswer(
  outcome: { proposed: string } | { refused: string },
  deps: SyncDeps,
): Promise<Answered> {
  if ('refused' in outcome)
    return { ok: false, error: outcome.refused, reason: outcome.refused };
  return { ok: true, proposed: outcome.proposed, personalSync: await statusOf(deps) };
}

/** Where sync stands: what the last run left, with the machines waiting or the key arrived asked fresh. */
async function statusOf(deps: SyncDeps): Promise<PersonalSyncStatus> {
  const state = await readSyncState(deps.home);
  const base = statusFromFile(state);
  if ((await readAccount(deps.home)) === null)
    return {
      ...base,
      state: PERSONAL_SYNC_STATE.OFF,
      said: 'This machine is not on Memnox Cloud, so there is nowhere to carry anything.',
    };
  const key = await readSyncKey(deps.secrets);
  if (key !== undefined) {
    const waiting = await waitingMachines(deps);
    return {
      ...base,
      keyId: syncKeyIdOf(key),
      waiting: waiting.ok ? waiting.value.filter((machine) => !machine.sealed) : [],
    };
  }
  const arrived = await arrivedFingerprint(deps);
  return arrived.ok && arrived.value !== undefined
    ? {
        ...base,
        state: PERSONAL_SYNC_STATE.KEY_ARRIVED,
        arrivedFingerprint: arrived.value,
      }
    : base;
}

function statusFromFile(state: PersonalSyncFile): PersonalSyncStatus {
  const counts = new Map<string, number>();
  for (const entry of Object.values(state.entries))
    if (entry.here) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  return {
    state: state.state ?? PERSONAL_SYNC_STATE.WAITING_FOR_KEY,
    said: state.said ?? 'Personal sync has not run on this machine yet.',
    ...(state.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.lastSyncedAt }),
    kinds: Object.values(SYNC_KIND).map((kind) => ({
      kind,
      items: counts.get(kind) ?? 0,
    })),
    conflicts: state.conflicts,
    skipped: [...state.skipped, ...waitingSaid(state)],
    openedElsewhere: state.openedElsewhere,
    waiting: [],
  };
}

/** What arrived and waits here, each said until it stands. */
function waitingSaid(state: PersonalSyncFile): string[] {
  return Object.values(state.entries).flatMap((entry) =>
    entry.here || entry.said === undefined ? [] : [entry.said],
  );
}

/** Each conflict copy opened here, beside what this machine holds of the same item now. */
async function conflictsAnswer(deps: SyncDeps): Promise<Answered> {
  const key = await readSyncKey(deps.secrets);
  if (key === undefined)
    return refused('This machine holds no sync key, so it cannot open a conflict copy.');
  const listed = await callSync<{ conflicts?: CloudConflict[] }>(
    deps.home,
    { method: 'GET', path: '/conflicts' },
    deps.send,
  );
  if (!listed.ok) return refused(listed.said);
  const local = await localSyncItems(deps.home);
  const syncConflicts = (listed.value.conflicts ?? []).flatMap((conflict) => {
    const opened = openedConflict(key, conflict);
    if (opened === undefined) return [];
    const mine = local.find(
      (item) => item.kind === opened.kind && item.name === opened.name,
    );
    const view: PersonalSyncConflict = {
      id: conflict.id,
      kind: opened.kind,
      name: opened.name,
      writtenBy: conflict.writtenBy,
      keptAt: conflict.keptAt,
      theirs: syncPlaintextOf(opened),
      ...(mine === undefined ? {} : { mine: syncPlaintextOf(mine) }),
    };
    return [view];
  });
  return { ok: true, syncConflicts, personalSync: await statusOf(deps) };
}

function openedConflict(key: Buffer, conflict: CloudConflict): SyncItem | undefined {
  if (conflict.keyId !== syncKeyIdOf(key)) return undefined;
  const text = openSyncItem(key, {
    kind: conflict.kind,
    id: conflict.itemId,
    ciphertext: conflict.ciphertext,
  });
  const opened = text === undefined ? undefined : syncItemOf(text);
  return opened !== undefined && opened.kind === conflict.kind ? opened : undefined;
}

/** Keeps one side: theirs is put back here and sent as the newest, mine lets the copy go. */
async function resolveAnswer(request: DaemonRequest, deps: SyncDeps): Promise<Answered> {
  const id = request.syncConflictId;
  if (id === undefined || request.syncKeep === undefined)
    return refused('Name the conflict and which side to keep, theirs or mine.');
  if (request.syncKeep === SYNC_KEEP.THEIRS) {
    const taken = await takeTheirs(deps, id);
    if (taken !== null) return refused(taken);
  }
  const path = `/conflicts/${encodeURIComponent(id)}`;
  const dismissed = await callSync(deps.home, { method: 'DELETE', path }, deps.send);
  if (!dismissed.ok) return refused(dismissed.said);
  await syncInTurn(deps);
  return { ok: true, personalSync: await statusOf(deps) };
}

/** The copy put back here the way anything arriving is; null when it was, else why not. */
async function takeTheirs(deps: SyncDeps, id: string): Promise<string | null> {
  const key = await readSyncKey(deps.secrets);
  if (key === undefined)
    return 'This machine holds no sync key, so it cannot open the copy.';
  const listed = await callSync<{ conflicts?: CloudConflict[] }>(
    deps.home,
    { method: 'GET', path: '/conflicts' },
    deps.send,
  );
  if (!listed.ok) return listed.said;
  const conflict = (listed.value.conflicts ?? []).find((each) => each.id === id);
  const opened = conflict === undefined ? undefined : openedConflict(key, conflict);
  if (opened === undefined) return `${id} is not a conflict copy this machine can open.`;
  await applySyncItem({ home: deps.home, at: deps.now().toISOString() }, opened);
  return null;
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

/** A signed key move carried out, and a sync run once the key arrived here. Null for another proposal. */
export async function applyPersonalSyncProposal(
  home: string,
  change: ProposedChange,
  deps: SyncDeps = syncDepsFor(home),
): Promise<{ ok: true; outcome: string } | { ok: false; error: string } | null> {
  if (change.kind !== PROPOSAL_KIND.PERSONAL_SYNC_KEY) return null;
  const moved = await carryOutKeyMove(deps, change);
  if (!moved.ok) return moved;
  if (change.open !== undefined) noteLocalChange(home, deps);
  return { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
}

/** The methods that change what this machine carries at once, after which a sync follows. */
const CHANGING_METHODS: readonly string[] = [
  MCP_HUB_METHOD.SERVER_PUT,
  MCP_HUB_METHOD.SERVER_REMOVE,
  MCP_HUB_METHOD.IMPORT,
  SKILLS_METHOD.SKILL_PUT,
  SKILLS_METHOD.SKILL_IMPORT,
  SKILLS_METHOD.SKILL_ACCEPT,
  SKILLS_METHOD.SKILL_ROLLBACK,
  PROJECTS_METHOD.PROJECT_OPEN,
  POLICY_METHOD.RULE_REMOVE,
  MEMORY_METHOD.MEMORY_CONFIRM,
  MEMORY_METHOD.MEMORY_EDIT,
  MEMORY_METHOD.MEMORY_FORGET,
];

/** The proposal kinds whose signed yes changes what this machine carries. */
const CHANGING_PROPOSALS: readonly string[] = [
  PROPOSAL_KIND.RULES,
  PROPOSAL_KIND.RULE_REMOVE,
  PROPOSAL_KIND.MCP_HUB,
  PROPOSAL_KIND.SKILLS_HUB,
  PROPOSAL_KIND.PROJECT,
];

export function changesSyncedItems(method: string): boolean {
  return CHANGING_METHODS.includes(method);
}

/** After a signed yes: a sync where it changed what this machine carries. */
export function afterConfirmed(home: string, kind: string, ok: boolean): void {
  if (ok && CHANGING_PROPOSALS.includes(kind)) noteLocalChange(home);
}

/** Each home's runs, one after another, so two never write the same state at once. */
const chains = new Map<string, Promise<void>>();
/** Homes with a sync after a change already queued, so a burst of changes is one more run. */
const queued = new Set<string>();

function inTurn(home: string, run: () => Promise<void>): Promise<void> {
  const next = (chains.get(home) ?? Promise.resolve()).then(run);
  // The chain carries on past a failed run; the caller of that run is the one told.
  const kept = next.catch(() => undefined);
  chains.set(home, kept);
  void kept.then(() => {
    if (chains.get(home) === kept) chains.delete(home);
  });
  return next;
}

/** A run the person asked for, after any already in flight. */
function syncInTurn(deps: SyncDeps): Promise<void> {
  return inTurn(deps.home, async () => {
    await syncNow(deps);
  });
}

/**
 * A sync after a local change, never awaited and never on a timer: only on Memnox Cloud with a key
 * already held, after any run in flight, and one for a burst of changes.
 */
export function noteLocalChange(home: string, deps: SyncDeps = syncDepsFor(home)): void {
  if (queued.has(home)) return;
  queued.add(home);
  void inTurn(home, async () => {
    queued.delete(home);
    await runAfterChange(deps);
  });
}

async function runAfterChange(deps: SyncDeps): Promise<void> {
  try {
    if ((await readAccount(deps.home)) === null) return;
    if ((await readSyncKey(deps.secrets)) === undefined) return;
    await syncNow(deps);
  } catch {
    // A sync that fails after a change is said by the next status; the change itself already held.
  }
}
