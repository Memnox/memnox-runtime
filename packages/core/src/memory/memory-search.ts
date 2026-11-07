import { MEMORY_SEARCH_MODE, type MemorySearchMode } from '../daemon/memory';
import { fuseRankings, type EmbeddingPort } from './embedding';
import type { MemoryItem } from './memory-record';
import type { PassageHit } from './memory-passages';
import {
  MOST_ITEMS_LISTED,
  type ItemFilter,
  type SqliteMemoryStore,
} from './memory-store';
import type { SqliteMemoryVectors } from './memory-vectors';

/**
 * One search over what was learned: the keyword index always, and by meaning too where the person
 * turned a local embedding model on. When the model is off or does not answer, the answer is the
 * keyword one and says so, never an empty list passed off as nothing found.
 */

/** Items embedded per search at most, so a first search over a large memory stays bounded; the rest follow. */
export const MOST_EMBEDDED_PER_SEARCH = 64;
/** Passages a search answers at most, beside the items. */
export const MOST_PASSAGES_FOUND = 20;

export interface MemorySearchInput {
  store: SqliteMemoryStore;
  vectors: SqliteMemoryVectors;
  query: string;
  filter: ItemFilter;
  /** Null when semantic search is off. */
  embedder: EmbeddingPort | null;
}

export interface MemorySearchResult {
  items: MemoryItem[];
  mode: MemorySearchMode;
  /** Why it is keyword only although semantic search is on. */
  note?: string;
  /** Passages of the read documents that matched, best first. */
  passages: PassageHit[];
}

export async function searchMemory(
  input: MemorySearchInput,
): Promise<MemorySearchResult> {
  const { store, vectors, query, filter, embedder } = input;
  const found = store.searchPassages(query, MOST_PASSAGES_FOUND);
  const keyword = withCited(store, store.search(query, filter), found.cited, filter);
  const passages = found.hits;
  if (embedder === null)
    return { items: keyword, mode: MEMORY_SEARCH_MODE.KEYWORD, passages };
  let ranked: string[];
  try {
    await embedMissing(vectors, embedder);
    const [asked] = await embedder.embed([query]);
    if (asked === undefined) throw new Error('it returned no vector for the query');
    ranked = vectors.ranked(embedder.model, asked, filter);
  } catch (error) {
    // A model that did not answer still leaves the keyword search whole, so that is the answer.
    const why = error instanceof Error ? error.message : String(error);
    return {
      items: keyword,
      mode: MEMORY_SEARCH_MODE.KEYWORD,
      passages,
      note: `The embedding model ${embedder.model} did not answer (${why}), so this is keyword search only.`,
    };
  }
  const limit = Math.min(filter.limit ?? MOST_ITEMS_LISTED, MOST_ITEMS_LISTED);
  const byId = new Map(keyword.map((item) => [item.id, item]));
  const order = fuseRankings([...byId.keys()], ranked).slice(0, limit);
  const items = order.flatMap((id) => {
    const item = byId.get(id) ?? store.item(id);
    return item === null ? [] : [item];
  });
  return { items, mode: MEMORY_SEARCH_MODE.SEMANTIC, passages };
}

/** The keyword items, then any item a matching passage is evidence for, where the filter would list it. */
function withCited(
  store: SqliteMemoryStore,
  keyword: MemoryItem[],
  cited: readonly string[],
  filter: ItemFilter,
): MemoryItem[] {
  const listed = new Set(keyword.map((item) => item.id));
  const more = cited.flatMap((id) => {
    if (listed.has(id)) return [];
    const item = store.item(id);
    return item !== null && passes(item, filter) ? [item] : [];
  });
  const limit = Math.min(filter.limit ?? MOST_ITEMS_LISTED, MOST_ITEMS_LISTED);
  return [...keyword, ...more].slice(0, limit);
}

function passes(item: MemoryItem, filter: ItemFilter): boolean {
  if (filter.statuses !== undefined && !filter.statuses.includes(item.status))
    return false;
  if (filter.scope !== undefined && item.scope !== filter.scope) return false;
  if (filter.kinds !== undefined && !filter.kinds.includes(item.kind)) return false;
  return filter.sourceId === undefined || item.sourceId === filter.sourceId;
}

/** Vectors for items that have none from this model yet, a bounded batch at a time. */
async function embedMissing(
  vectors: SqliteMemoryVectors,
  embedder: EmbeddingPort,
): Promise<void> {
  const missing = vectors.missing(embedder.model, MOST_EMBEDDED_PER_SEARCH);
  if (missing.length === 0) return;
  const made = await embedder.embed(missing.map((each) => each.text));
  if (made.length !== missing.length)
    throw new Error(`it returned ${made.length} vectors for ${missing.length} texts`);
  missing.forEach((each, index) => {
    const vector = made[index];
    if (vector !== undefined) vectors.put(embedder.model, each, vector);
  });
}
