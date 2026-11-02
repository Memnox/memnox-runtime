import {
  MEMORY_METHOD,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  MEMORY_STATUSES,
  nodeSecretStore,
  OPEN_STATUSES,
  readWorkspaceMemory,
  searchMemory,
  SqliteMemoryStore,
  SqliteMemoryVectors,
  type DaemonRequest,
  type EmbeddingPort,
  type DaemonResponse,
  type ItemFilter,
  type MemoryScope,
  type MemoryStatus,
  type SecretStore,
  type SourceReach,
} from '@memnox/core';
import { ownExtractor, type ExtractRun } from '../memory/memory-brain';
import {
  confirmItem,
  editItem,
  rejectItem,
  settleProposals,
  type Learned,
} from '../memory/memory-learn';
import { memoryReach } from '../memory/memory-reach';
import { readSourceOnce } from '../memory/memory-reads';
import { addSource } from '../memory/memory-source-change';
import { itemsView, itemView, sourcesView } from '../memory/memory-views';
import { rewatchMemory } from '../memory/memory-watch';
import { embedderFor } from '../memory/ollama-embedding';
import { noteSearchTime } from '../memory/search-times';
import { readWorkspaceGraph, type WorkspaceGraphDeps } from '../sync/workspace-graph';
import { isMemoryLayersMethod, memoryLayersAnswer } from './memory-layers-answer';

/**
 * The memory methods. Reads come from the local store; a confirm of a fact verifies it, a confirm
 * of a rule raises the signed proposal every rule waits on, and a rejection is remembered.
 */

const MEMORY_METHODS: readonly string[] = Object.values(MEMORY_METHOD);
const SCOPES: readonly string[] = [MEMORY_SCOPE.PERSONAL, MEMORY_SCOPE.PROJECT];

export function isMemoryMethod(method: string): boolean {
  return MEMORY_METHODS.includes(method);
}

interface MemoryDeps {
  now: Date;
  reach?: SourceReach;
  extract?: ExtractRun;
  secrets?: SecretStore;
  /** The embedding model search also ranks by; read from the config when absent, null when it is off. */
  embedder?: EmbeddingPort | null;
  /** How the live workspace graph reaches the cloud; the real client when absent. */
  graph?: Pick<WorkspaceGraphDeps, 'call'>;
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function memoryAnswer(
  home: string,
  request: DaemonRequest,
  deps: MemoryDeps,
): Promise<DaemonResponse> {
  const store = SqliteMemoryStore.forHome(home);
  try {
    const answered = await answerOf(home, store, request, deps).catch(
      (err: unknown): Answered =>
        refused(err instanceof Error ? err.message : String(err)),
    );
    return { id: request.id, ...answered };
  } finally {
    store.close();
  }
}

async function answerOf(
  home: string,
  store: SqliteMemoryStore,
  request: DaemonRequest,
  deps: MemoryDeps,
): Promise<Answered> {
  if (isMemoryLayersMethod(request.method))
    return memoryLayersAnswer(home, store, { request, now: deps.now });
  switch (request.method) {
    case MEMORY_METHOD.MEMORY_SOURCES:
      return sources(home, store, deps);
    case MEMORY_METHOD.MEMORY_SOURCE_ADD:
      return add(home, store, request, deps);
    case MEMORY_METHOD.MEMORY_SOURCE_REMOVE:
      return remove(home, store, request.memorySourceId, deps);
    case MEMORY_METHOD.MEMORY_SOURCE_READ:
      return read(home, store, request.memorySourceId, deps);
    case MEMORY_METHOD.MEMORY_LEARN:
      return learn(home, store, request.memoryScope, deps.now);
    case MEMORY_METHOD.MEMORY_SEARCH:
    case MEMORY_METHOD.MEMORY_FACTS:
      return facts(home, store, request, deps);
    case MEMORY_METHOD.WORKSPACE_MEMORY:
      return workspace(home);
    case MEMORY_METHOD.WORKSPACE_GRAPH:
      return {
        ok: true,
        workspaceGraph: await readWorkspaceGraph(home, {
          ...deps.graph,
          fresh: request.workspaceGraphFresh === true,
          now: () => deps.now,
        }),
      };
    default:
      return answerChange(home, store, request, deps);
  }
}

async function answerChange(
  home: string,
  store: SqliteMemoryStore,
  request: DaemonRequest,
  deps: MemoryDeps,
): Promise<Answered> {
  const id = request.memoryItemId;
  if (id === undefined || id === '') return refused('Name the memory.');
  switch (request.method) {
    case MEMORY_METHOD.MEMORY_CONFIRM:
      return learned(home, store, await confirmItem(home, store, id, deps.now), deps.now);
    case MEMORY_METHOD.MEMORY_REJECT:
      return learned(home, store, rejectItem(store, id, deps.now), deps.now);
    case MEMORY_METHOD.MEMORY_EDIT:
      if (request.memoryEdit === undefined) return refused('Send what to change.');
      return learned(home, store, editItem(store, id, request.memoryEdit), deps.now);
    case MEMORY_METHOD.MEMORY_FORGET:
      return store.forget(id) ? { ok: true } : refused(`No memory ${id}.`);
    default:
      return { ok: true };
  }
}

/** The workspace's pull as it lies on disk, so a screen reads exactly what agents are briefed with. */
async function workspace(home: string): Promise<Answered> {
  const memory = await readWorkspaceMemory(home);
  return memory === null ? { ok: true } : { ok: true, workspaceMemory: memory };
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

function secretsOf(home: string, deps: MemoryDeps): SecretStore {
  return deps.secrets ?? nodeSecretStore(home);
}

async function sources(
  home: string,
  store: SqliteMemoryStore,
  deps: MemoryDeps,
): Promise<Answered> {
  return { ok: true, memorySources: await sourcesView(store, secretsOf(home, deps)) };
}

/** Kept at once and read in the background, since a first read can take the extractor minutes. */
async function add(
  home: string,
  store: SqliteMemoryStore,
  request: DaemonRequest,
  deps: MemoryDeps,
): Promise<Answered> {
  if (request.memorySource === undefined) return refused('Send the source to add.');
  const added = await addSource(home, store, request.memorySource, deps.now);
  if ('refused' in added) return refused(added.refused);
  void readSourceOnce(home, added.source.id, readDeps(home, deps));
  rewatchMemory(home);
  return sources(home, store, deps);
}

async function remove(
  home: string,
  store: SqliteMemoryStore,
  id: string | undefined,
  deps: MemoryDeps,
): Promise<Answered> {
  if (id === undefined || store.source(id) === null)
    return refused('Name a source that is here.');
  store.removeSource(id, deps.now.toISOString());
  rewatchMemory(home);
  return sources(home, store, deps);
}

async function read(
  home: string,
  store: SqliteMemoryStore,
  id: string | undefined,
  deps: MemoryDeps,
): Promise<Answered> {
  if (id === undefined || store.source(id) === null)
    return refused('Name a source that is here.');
  const summary = await readSourceOnce(home, id, readDeps(home, deps));
  return { ...(await sources(home, store, deps)), memoryRead: summary };
}

function readDeps(
  home: string,
  deps: MemoryDeps,
): {
  reach: SourceReach;
  extract: ExtractRun;
  now: () => Date;
} {
  return {
    reach: deps.reach ?? memoryReach(home, secretsOf(home, deps)),
    extract: deps.extract ?? ownExtractor(home),
    now: () => new Date(),
  };
}

/** The queue, with any rule whose proposal was answered moved on first. */
async function learn(
  home: string,
  store: SqliteMemoryStore,
  asked: string | undefined,
  now: Date,
): Promise<Answered> {
  await settleProposals(home, store, now);
  const scope = scopeOf(asked);
  const filter: ItemFilter = {
    statuses: OPEN_STATUSES,
    ...(scope === undefined ? {} : { scope }),
  };
  return { ok: true, memoryLearn: listed(store, filter) };
}

async function learned(
  home: string,
  store: SqliteMemoryStore,
  outcome: Learned,
  now: Date,
): Promise<Answered> {
  if ('refused' in outcome) return refused(outcome.refused);
  const queue = await learn(home, store, undefined, now);
  return {
    ...queue,
    memoryItem: itemView(store, outcome.item),
    ...(outcome.proposed === undefined ? {} : { proposed: outcome.proposed }),
  };
}

/** Verified by default; SEARCH reads every status unless one is named, by keyword and by meaning where that is on. */
async function facts(
  home: string,
  store: SqliteMemoryStore,
  request: DaemonRequest,
  deps: MemoryDeps,
): Promise<Answered> {
  const scope = scopeOf(request.memoryScope);
  const status = statusOf(request.memoryStatus);
  const search = request.method === MEMORY_METHOD.MEMORY_SEARCH;
  const filter: ItemFilter = {
    ...(scope === undefined ? {} : { scope }),
    ...(status !== undefined
      ? { statuses: [status] }
      : search
        ? {}
        : { statuses: [MEMORY_STATUS.VERIFIED] }),
  };
  if (!search) return { ok: true, memoryFacts: listed(store, filter) };
  const query = (request.memoryQuery ?? '').trim();
  if (query === '') return refused('Say what to look for.');
  const embedder = deps.embedder === undefined ? await embedderFor(home) : deps.embedder;
  const vectors = SqliteMemoryVectors.forHome(home);
  try {
    const started = performance.now();
    const found = await searchMemory({ store, vectors, query, filter, embedder });
    // A time that could not be kept leaves the search answered; only the median misses it.
    await noteSearchTime(home, performance.now() - started).catch(() => undefined);
    return {
      ok: true,
      memoryFacts: itemsView(store, found.items, found.items.length),
      memorySearchMode: found.mode,
      ...(found.note === undefined ? {} : { memorySearchNote: found.note }),
      ...(found.passages.length === 0
        ? {}
        : { memoryPassages: found.passages.map(({ digest: _, ...passage }) => passage) }),
    };
  } finally {
    vectors.close();
  }
}

/** A page and the count behind it, so a cut list says how much more there is. */
function listed(
  store: SqliteMemoryStore,
  filter: ItemFilter,
): ReturnType<typeof itemsView> {
  return itemsView(store, store.items(filter), store.count(filter));
}

function scopeOf(value: string | undefined): MemoryScope | undefined {
  // Cast is safe: checked against the two scopes memory keeps.
  return value !== undefined && SCOPES.includes(value)
    ? (value as MemoryScope)
    : undefined;
}

function statusOf(value: string | undefined): MemoryStatus | undefined {
  // Cast is safe: checked against the statuses the store keeps.
  return value !== undefined && MEMORY_STATUSES.includes(value)
    ? (value as MemoryStatus)
    : undefined;
}
