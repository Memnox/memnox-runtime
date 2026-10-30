import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

import { MEMNOX_HOME } from '../config/config';
import type { MemoryScope } from '../projects/project';
import type { MemorySourceRecord } from '../memory-sources/memory-source';
import {
  disagrees,
  LIVE_STATUSES,
  MEMORY_STATUS,
  restates,
  statementKey,
  type MemoryEvidence,
  type MemoryItem,
  type MemoryKind,
  type MemoryRule,
  type MemoryStatus,
} from './memory-record';
import {
  evidenceOfRow,
  ITEM_COLUMNS,
  itemOfRow,
  itemToRow,
  MEMORY_DATABASE_FILE,
  MEMORY_SCHEMA,
  SOURCE_COLUMNS,
  sourceOfRow,
  sourceToRow,
  type EvidenceRow,
  type ItemRow,
  type SourceRow,
} from './memory-schema';

/**
 * What this machine learned, in SQLite beside the ledger: sources, the passages last read from
 * each, items with their evidence, and the wordings a person rejected. WAL, since the daemon
 * writes while a session server reads.
 */

const BUSY_TIMEOUT_MS = 5_000;
/** Enough of a list for any screen; a longer one is paged by a narrower filter. */
export const MOST_ITEMS_LISTED = 500;
/** How many near matches are weighed as the one a new candidate restates. */
const RESTATE_PROBES = 10;

export function memoryDatabasePathFor(home: string): string {
  return join(home, MEMNOX_HOME, MEMORY_DATABASE_FILE);
}

/** An item as it arrives, before the store gives it an id, a status and a time. */
export type NewMemoryItem = Omit<
  MemoryItem,
  'id' | 'status' | 'createdAt' | 'duplicateOf' | 'evidence'
> & { evidence: Omit<MemoryEvidence, 'stale'>[] };

export type AddOutcome =
  { added: MemoryItem } | { merged: string } | { rejectedBefore: true };

export interface ItemFilter {
  statuses?: readonly MemoryStatus[];
  scope?: MemoryScope;
  kinds?: readonly MemoryKind[];
  sourceId?: string;
  limit?: number;
}

export interface ItemEdit {
  statement?: string;
  subject?: string;
  rule?: MemoryRule;
}

export class SqliteMemoryStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db.exec(MEMORY_SCHEMA);
  }

  static forHome(home: string): SqliteMemoryStore {
    return new SqliteMemoryStore(memoryDatabasePathFor(home));
  }

  close(): void {
    this.db.close();
  }

  putSource(source: MemorySourceRecord): void {
    const names = SOURCE_COLUMNS.map((column) => `@${column}`).join(', ');
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sources (${SOURCE_COLUMNS.join(', ')}) VALUES (${names})`,
      )
      .run(sourceToRow(source));
  }

  source(id: string): MemorySourceRecord | null {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    // Cast is safe: every row in `sources` was written by putSource.
    return row === undefined ? null : sourceOfRow(row as SourceRow);
  }

  sources(): MemorySourceRecord[] {
    const rows = this.db.prepare('SELECT * FROM sources ORDER BY addedAt').all();
    // Cast is safe: every row in `sources` was written by putSource.
    return (rows as SourceRow[]).map(sourceOfRow);
  }

  /** The source and what was read from it go; what it taught goes outdated rather than vanishing. */
  removeSource(id: string, at: string): number {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM documents WHERE sourceId = ?').run(id);
      this.db.prepare('DELETE FROM passages WHERE sourceId = ?').run(id);
      this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
      return this.refreshStaleness(id, at);
    })();
  }

  markRead(id: string, at: string, error?: string): void {
    this.db
      .prepare('UPDATE sources SET lastReadAt = ?, lastError = ? WHERE id = ?')
      .run(at, error ?? null, id);
  }

  documentStamps(sourceId: string): Map<string, string> {
    const rows = this.db
      .prepare('SELECT document, stamp FROM documents WHERE sourceId = ?')
      .all(sourceId) as { document: string; stamp: string }[];
    return new Map(rows.map((row) => [row.document, row.stamp]));
  }

  knownDigests(sourceId: string, document: string): Set<string> {
    const rows = this.db
      .prepare('SELECT digest FROM passages WHERE sourceId = ? AND document = ?')
      .all(sourceId, document) as { digest: string }[];
    return new Set(rows.map((row) => row.digest));
  }

  /** The document's passages as read now; an empty stamp has it read again next time. */
  putDocument(
    sourceId: string,
    document: string,
    stamp: string,
    digests: string[],
  ): void {
    this.db.transaction(() => {
      this.dropDocument(sourceId, document);
      this.db
        .prepare('INSERT INTO documents (sourceId, document, stamp) VALUES (?, ?, ?)')
        .run(sourceId, document, stamp);
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO passages (sourceId, document, digest) VALUES (?, ?, ?)',
      );
      for (const digest of digests) insert.run(sourceId, document, digest);
    })();
  }

  dropDocument(sourceId: string, document: string): void {
    this.db
      .prepare('DELETE FROM documents WHERE sourceId = ? AND document = ?')
      .run(sourceId, document);
    this.db
      .prepare('DELETE FROM passages WHERE sourceId = ? AND document = ?')
      .run(sourceId, document);
  }

  /** Evidence whose passage is no longer there goes stale, and an item left with none goes outdated. */
  refreshStaleness(sourceId: string, at: string): number {
    this.db
      .prepare(
        `UPDATE evidence SET stale = 1 WHERE sourceId = ? AND stale = 0 AND NOT EXISTS (
           SELECT 1 FROM passages p WHERE p.sourceId = evidence.sourceId
             AND p.document = evidence.document AND p.digest = evidence.digest)`,
      )
      .run(sourceId);
    const live = LIVE_STATUSES.map((_, index) => `@live${index}`).join(', ');
    const params: Record<string, string> = {
      sourceId,
      at,
      outdated: MEMORY_STATUS.OUTDATED,
    };
    LIVE_STATUSES.forEach((status, index) => (params[`live${index}`] = status));
    const result = this.db
      .prepare(
        `UPDATE items SET status = @outdated, decidedAt = @at, proposalId = NULL
         WHERE status IN (${live})
           AND id IN (SELECT itemId FROM evidence WHERE sourceId = @sourceId)
           AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.itemId = items.id AND e.stale = 0)`,
      )
      .run(params);
    return result.changes;
  }

  isRejected(kind: string, statement: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM rejections WHERE key = ?')
      .get(statementKey(kind, statement));
    return row !== undefined;
  }

  /** A new candidate, or more evidence for the same words, or nothing for words a person rejected. */
  add(input: NewMemoryItem, at: string): AddOutcome {
    if (this.isRejected(input.kind, input.statement)) return { rejectedBefore: true };
    const key = statementKey(input.kind, input.statement);
    const same = this.liveWithKey(key);
    if (same !== null) {
      this.addEvidence(same, input.evidence);
      return { merged: same };
    }
    const duplicateOf = this.restated(input);
    const item: MemoryItem = {
      ...input,
      id: `mem_${randomUUID()}`,
      status: MEMORY_STATUS.CANDIDATE,
      createdAt: at,
      ...(duplicateOf === undefined ? {} : { duplicateOf }),
      evidence: input.evidence.map((each) => ({ ...each, stale: false })),
    };
    this.db.transaction(() => {
      this.insertItem(item, key);
      this.addEvidence(item.id, input.evidence);
    })();
    return { added: item };
  }

  item(id: string): MemoryItem | null {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    // Cast is safe: every row in `items` was written by insertItem.
    return row === undefined ? null : this.withEvidence(row as ItemRow);
  }

  items(filter: ItemFilter = {}): MemoryItem[] {
    const { clause, params } = whereOf(filter);
    const limit = Math.min(filter.limit ?? MOST_ITEMS_LISTED, MOST_ITEMS_LISTED);
    const rows = this.db
      .prepare(`SELECT * FROM items${clause} ORDER BY createdAt DESC, id LIMIT ${limit}`)
      .all(params) as ItemRow[];
    return rows.map((row) => this.withEvidence(row));
  }

  count(filter: ItemFilter = {}): number {
    const { clause, params } = whereOf(filter);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM items${clause}`).get(params);
    // Cast is safe: COUNT(*) answers one row with one number.
    return (row as { n: number }).n;
  }

  /** Items whose words match, best first, by the keyword index. */
  search(query: string, filter: ItemFilter = {}): MemoryItem[] {
    const match = matchExpression(query);
    if (match === '') return [];
    const { clause, params } = whereOf(filter, 'i.');
    const limit = Math.min(filter.limit ?? MOST_ITEMS_LISTED, MOST_ITEMS_LISTED);
    const joined = clause === '' ? ' WHERE' : `${clause} AND`;
    const rows = this.db
      .prepare(
        `SELECT i.* FROM items_fts f JOIN items i ON i.id = f.id${joined} items_fts MATCH @match
         ORDER BY bm25(items_fts) LIMIT ${limit}`,
      )
      .all({ ...params, match }) as ItemRow[];
    return rows.map((row) => this.withEvidence(row));
  }

  /** How many items each source taught, by status. */
  countsBySource(): Map<string, Partial<Record<MemoryStatus, number>>> {
    const rows = this.db
      .prepare(
        'SELECT sourceId, status, COUNT(*) AS n FROM items WHERE sourceId IS NOT NULL GROUP BY sourceId, status',
      )
      .all() as { sourceId: string; status: MemoryStatus; n: number }[];
    const counts = new Map<string, Partial<Record<MemoryStatus, number>>>();
    for (const row of rows)
      counts.set(row.sourceId, { ...counts.get(row.sourceId), [row.status]: row.n });
    return counts;
  }

  decide(id: string, status: MemoryStatus, decided: { by: string; at: string }): void {
    this.db
      .prepare(
        'UPDATE items SET status = ?, decidedBy = ?, decidedAt = ?, proposalId = NULL WHERE id = ?',
      )
      .run(status, decided.by, decided.at, id);
  }

  /** Rejected, and its words remembered, so reading them again never proposes them again. */
  reject(id: string, decided: { by: string; at: string }): void {
    const item = this.item(id);
    if (item === null) return;
    this.decide(id, MEMORY_STATUS.REJECTED, decided);
    this.db
      .prepare('INSERT OR REPLACE INTO rejections (key, at) VALUES (?, ?)')
      .run(statementKey(item.kind, item.statement), decided.at);
  }

  setProposal(id: string, proposalId: string | null): void {
    this.db.prepare('UPDATE items SET proposalId = ? WHERE id = ?').run(proposalId, id);
  }

  edit(id: string, change: ItemEdit): MemoryItem | null {
    const item = this.item(id);
    if (item === null) return null;
    const edited: MemoryItem = { ...item, ...change };
    this.db.transaction(() => {
      this.deleteItemRow(id);
      this.insertItem(edited, statementKey(edited.kind, edited.statement));
    })();
    return edited;
  }

  forget(id: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM evidence WHERE itemId = ?').run(id);
      return this.deleteItemRow(id);
    })();
  }

  /** Confirmed facts that say the opposite of this one, flagged with it for a person to decide. */
  flagConflicts(id: string, at: string): string[] {
    const item = this.item(id);
    if (item === null) return [];
    const opposed = this.items({
      statuses: [MEMORY_STATUS.VERIFIED, MEMORY_STATUS.CONFLICTING],
    })
      .filter((other) => disagrees(item, other))
      .map((other) => other.id);
    if (opposed.length === 0) return [];
    const flag = this.db.prepare(
      'UPDATE items SET status = ?, decidedAt = ? WHERE id = ?',
    );
    for (const each of [id, ...opposed]) flag.run(MEMORY_STATUS.CONFLICTING, at, each);
    return opposed;
  }

  /** What has said its last word and is older than the window; rejected wordings stay remembered. */
  pruneBefore(cutoff: string, dryRun = false): number {
    const ended = [
      MEMORY_STATUS.REJECTED,
      MEMORY_STATUS.SUPERSEDED,
      MEMORY_STATUS.OUTDATED,
    ];
    const rows = this.db
      .prepare(
        `SELECT id FROM items WHERE status IN (?, ?, ?) AND COALESCE(decidedAt, createdAt) < ?
         LIMIT ${MOST_ITEMS_LISTED}`,
      )
      .all(...ended, cutoff) as { id: string }[];
    if (!dryRun) for (const row of rows) this.forget(row.id);
    return rows.length;
  }

  private liveWithKey(key: string): string | null {
    const live = LIVE_STATUSES.map(() => '?').join(', ');
    const row = this.db
      .prepare(`SELECT id FROM items WHERE key = ? AND status IN (${live}) LIMIT 1`)
      .get(key, ...LIVE_STATUSES) as { id: string } | undefined;
    return row === undefined ? null : row.id;
  }

  private restated(input: NewMemoryItem): string | undefined {
    const near = this.search(input.statement, {
      statuses: LIVE_STATUSES,
      kinds: [input.kind],
      limit: RESTATE_PROBES,
    });
    const found = near.find((each) => restates(each.statement, input.statement));
    return found === undefined ? undefined : found.id;
  }

  private insertItem(item: MemoryItem, key: string): void {
    const names = ITEM_COLUMNS.map((column) => `@${column}`).join(', ');
    this.db
      .prepare(`INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES (${names})`)
      .run(itemToRow(item, key));
    this.db
      .prepare('INSERT INTO items_fts (id, statement, subject) VALUES (?, ?, ?)')
      .run(item.id, item.statement, item.subject);
  }

  private deleteItemRow(id: string): boolean {
    this.db.prepare('DELETE FROM items_fts WHERE id = ?').run(id);
    return this.db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  }

  private addEvidence(
    itemId: string,
    evidence: readonly Omit<MemoryEvidence, 'stale'>[],
  ): void {
    const held = this.db.prepare(
      'SELECT 1 FROM evidence WHERE itemId = ? AND sourceId = ? AND document = ? AND digest = ?',
    );
    const insert = this.db.prepare(
      'INSERT INTO evidence (itemId, sourceId, document, heading, url, digest, stale) VALUES (?, ?, ?, ?, ?, ?, 0)',
    );
    for (const each of evidence) {
      if (held.get(itemId, each.sourceId, each.document, each.digest) !== undefined)
        continue;
      insert.run(
        itemId,
        each.sourceId,
        each.document,
        each.heading ?? null,
        each.url ?? null,
        each.digest,
      );
    }
  }

  private withEvidence(row: ItemRow): MemoryItem {
    const rows = this.db
      .prepare('SELECT * FROM evidence WHERE itemId = ? ORDER BY rowid')
      .all(row.id) as EvidenceRow[];
    return itemOfRow(row, rows.map(evidenceOfRow));
  }
}

/** Named parameters only, so nothing a filter carries is spliced into the SQL. */
function whereOf(
  filter: ItemFilter,
  prefix = '',
): { clause: string; params: Record<string, string> } {
  const where: string[] = [];
  const params: Record<string, string> = {};
  const listed = (column: string, values: readonly string[] | undefined): void => {
    if (values === undefined || values.length === 0) return;
    const names = values.map((value, index) => {
      params[`${column}${index}`] = value;
      return `@${column}${index}`;
    });
    where.push(`${prefix}${column} IN (${names.join(', ')})`);
  };
  listed('status', filter.statuses);
  listed('kind', filter.kinds);
  if (filter.scope !== undefined) listed('scope', [filter.scope]);
  if (filter.sourceId !== undefined) listed('sourceId', [filter.sourceId]);
  return { clause: where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`, params };
}

/** Each word quoted as a phrase, so nothing a person types is read as FTS syntax. */
function matchExpression(query: string): string {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
  return [...new Set(words)].map((word) => `"${word}"`).join(' OR ');
}
