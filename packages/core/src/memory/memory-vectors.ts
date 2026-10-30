import Database from 'better-sqlite3';

import { cosine } from './embedding';
import { MEMORY_SCHEMA } from './memory-schema';
import { memoryDatabasePathFor, whereOf, type ItemFilter } from './memory-store';

/**
 * Each item's vector beside it in `memory.db`, under the model that made it and the words it was
 * made from, so a changed statement or another model is embedded again rather than compared stale.
 */

const BUSY_TIMEOUT_MS = 5_000;

/** The most vectors one search scores, so a large memory costs a bounded read. */
const MOST_SCORED = 5_000;

/** Below this a match is noise rather than meaning, so it does not join the ranking. */
const LEAST_SIMILARITY = 0.3;

export interface Unembedded {
  id: string;
  text: string;
}

export class SqliteMemoryVectors {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db.exec(MEMORY_SCHEMA);
  }

  static forHome(home: string): SqliteMemoryVectors {
    return new SqliteMemoryVectors(memoryDatabasePathFor(home));
  }

  close(): void {
    this.db.close();
  }

  /** Items with no vector from this model, or one made from words they no longer say. */
  missing(model: string, limit: number): Unembedded[] {
    return this.db
      .prepare(
        `SELECT i.id AS id, i.statement AS text FROM items i
         LEFT JOIN item_vectors v ON v.itemId = i.id AND v.model = @model
         WHERE v.itemId IS NULL OR v.text <> i.statement LIMIT ${Number(limit)}`,
      )
      .all({ model }) as Unembedded[];
  }

  put(model: string, item: Unembedded, vector: readonly number[]): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO item_vectors (itemId, model, text, vector) VALUES (?, ?, ?, ?)',
      )
      .run(item.id, model, item.text, Buffer.from(new Float32Array(vector).buffer));
  }

  /** Ids the filter allows, closest to the query first, each close enough to mean something. */
  ranked(model: string, query: readonly number[], filter: ItemFilter): string[] {
    const { clause, params } = whereOf(filter, 'i.');
    const joined = clause === '' ? ' WHERE' : `${clause} AND`;
    const rows = this.db
      .prepare(
        `SELECT v.itemId AS id, v.vector AS vector FROM item_vectors v
         JOIN items i ON i.id = v.itemId AND v.text = i.statement${joined} v.model = @model
         LIMIT ${MOST_SCORED}`,
      )
      .all({ ...params, model }) as { id: string; vector: Buffer }[];
    return rows
      .map((row) => ({ id: row.id, score: cosine(query, vectorOf(row.vector)) }))
      .filter((each) => each.score >= LEAST_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .map((each) => each.id);
  }
}

/** Copied out first, since a blob's bytes need not start where a float may. */
function vectorOf(blob: Buffer): number[] {
  return [...new Float32Array(new Uint8Array(blob).buffer)];
}
