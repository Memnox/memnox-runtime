import type Database from 'better-sqlite3';

/**
 * The keyword index over what each source read: the document's name and every passage's heading
 * and words, so a search finds a file and a passage and not only the facts learned out of them.
 * It lives beside `items_fts` in memory.db and is kept in step by the store.
 */

export const PASSAGE_INDEX_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
  sourceId UNINDEXED, document, digest UNINDEXED, heading, text, tokenize = 'porter unicode61'
);
`;

/** The schema version that first indexed passages; a store opened below it reads its documents again. */
const PASSAGES_INDEXED_VERSION = 1;
/** Words of a passage shown around a match. */
const SNIPPET_TOKENS = 16;

/** A passage as the index keeps it: a digest alone is one read before the index, kept unsearchable. */
export interface IndexedPassage {
  digest: string;
  heading?: string;
  text?: string;
}

export interface PassageHit {
  sourceId: string;
  document: string;
  digest: string;
  heading?: string;
  snippet: string;
}

/** The words of a query as FTS5 matches any of them, quoted so no word is read as syntax. */
export function matchExpression(query: string): string {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
  return [...new Set(words)].map((word) => `"${word}"`).join(' OR ');
}

/** A store from before the index forgets its stamps once, so the next read indexes every passage it keeps. */
export function migratePassageIndex(db: Database.Database): void {
  db.exec(PASSAGE_INDEX_SCHEMA);
  // Cast is safe: user_version always answers one number.
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= PASSAGES_INDEXED_VERSION) return;
  db.transaction(() => {
    db.prepare("UPDATE documents SET stamp = ''").run();
    db.pragma(`user_version = ${PASSAGES_INDEXED_VERSION}`);
  })();
}

export function indexPassages(
  db: Database.Database,
  at: { sourceId: string; document: string },
  passages: readonly IndexedPassage[],
): void {
  const insert = db.prepare(
    'INSERT INTO passages_fts (sourceId, document, digest, heading, text) VALUES (?, ?, ?, ?, ?)',
  );
  for (const passage of passages)
    if (passage.text !== undefined)
      insert.run(
        at.sourceId,
        at.document,
        passage.digest,
        passage.heading ?? '',
        passage.text,
      );
}

/** Every passage of one document, or of the whole source when no document is named. */
export function dropPassageIndex(
  db: Database.Database,
  sourceId: string,
  document?: string,
): void {
  if (document === undefined)
    db.prepare('DELETE FROM passages_fts WHERE sourceId = ?').run(sourceId);
  else
    db.prepare('DELETE FROM passages_fts WHERE sourceId = ? AND document = ?').run(
      sourceId,
      document,
    );
}

/** Passages whose name, heading or words match, best first. */
export function searchPassages(
  db: Database.Database,
  query: string,
  limit: number,
): PassageHit[] {
  const match = matchExpression(query);
  if (match === '') return [];
  const rows = db
    .prepare(
      `SELECT sourceId, document, digest, heading,
         snippet(passages_fts, 4, '', '', '…', ${SNIPPET_TOKENS}) AS snippet
       FROM passages_fts WHERE passages_fts MATCH @match
       ORDER BY bm25(passages_fts) LIMIT ${limit}`,
    )
    // Cast is safe: the columns are exactly the ones selected.
    .all({ match }) as {
    sourceId: string;
    document: string;
    digest: string;
    heading: string;
    snippet: string;
  }[];
  return rows.map((row) => ({
    sourceId: row.sourceId,
    document: row.document,
    digest: row.digest,
    ...(row.heading === '' ? {} : { heading: row.heading }),
    snippet: row.snippet,
  }));
}

/** The items whose evidence cites any of these passages, in the order the passages came. */
export function itemsCiting(
  db: Database.Database,
  hits: readonly PassageHit[],
): string[] {
  const cited = db.prepare(
    'SELECT DISTINCT itemId FROM evidence WHERE sourceId = ? AND document = ? AND digest = ?',
  );
  const ids = hits.flatMap((hit) =>
    // Cast is safe: one column, itemId, is selected.
    (cited.all(hit.sourceId, hit.document, hit.digest) as { itemId: string }[]).map(
      (row) => row.itemId,
    ),
  );
  return [...new Set(ids)];
}
