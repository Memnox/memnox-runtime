import { MEMORY_SEARCH_MODE, type MemorySearchMode } from '../daemon/memory';
import { fuseRankings, type EmbeddingPort } from './embedding';
import type { MemoryItem } from './memory-record';
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
}

export async function searchMemory(
  input: MemorySearchInput,
): Promise<MemorySearchResult> {
  const { store, vectors, query, filter, embedder } = input;
  const keyword = store.search(query, filter);
  if (embedder === null) return { items: keyword, mode: MEMORY_SEARCH_MODE.KEYWORD };
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
  return { items, mode: MEMORY_SEARCH_MODE.SEMANTIC };
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
