import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  memoryDatabasePathFor,
  searchMemory,
  SqliteMemoryStore,
  SqliteMemoryVectors,
} from '../src/index';

/**
 * The passage index: a document's name and its passages' words are found by a search, an item a
 * matching passage is evidence for joins the answer, and a store from before the index reads again.
 */

const AT = '2026-10-30T09:00:00.000Z';

async function opened(): Promise<{ home: string; store: SqliteMemoryStore }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-passages-'));
  return { home, store: SqliteMemoryStore.forHome(home) };
}

describe('the passage index', () => {
  it('finds a passage by its words and its document by name, and forgets them with the document', async () => {
    const { store } = await opened();
    store.putDocument('src_vault', 'runbooks/rollback.md', 's1', [
      {
        digest: 'd1',
        heading: 'Rolling back',
        text: 'Roll back with the blue green switch.',
      },
      'd2',
    ]);
    const found = store.searchPassages('switch', 10);
    expect(found.hits).toEqual([
      expect.objectContaining({
        document: 'runbooks/rollback.md',
        heading: 'Rolling back',
      }),
    ]);
    expect(found.hits[0]?.snippet).toContain('switch');
    expect(store.searchPassages('runbooks', 10).hits).toHaveLength(1);
    store.dropDocument('src_vault', 'runbooks/rollback.md');
    expect(store.searchPassages('switch', 10).hits).toEqual([]);
    store.close();
  });

  it('folds an item a matching passage is evidence for into the keyword search', async () => {
    const { home, store } = await opened();
    store.putDocument('src_vault', 'ops.md', 's1', [
      { digest: 'd1', text: 'The freeze starts on the twentieth.' },
    ]);
    const outcome = store.add(
      {
        kind: MEMORY_KIND.FACT,
        statement: 'No releases in late December.',
        subject: 'releases',
        scope: MEMORY_SCOPE.PERSONAL,
        origin: MEMORY_ORIGIN.EXTRACTED,
        tainted: false,
        evidence: [{ sourceId: 'src_vault', document: 'ops.md', digest: 'd1' }],
      },
      AT,
    );
    if (!('added' in outcome)) throw new Error('expected a new item');
    const vectors = SqliteMemoryVectors.forHome(home);
    const answer = await searchMemory({
      store,
      vectors,
      query: 'freeze',
      filter: {},
      embedder: null,
    });
    expect(answer.items.map((item) => item.id)).toEqual([outcome.added.id]);
    expect(answer.passages.map((hit) => hit.document)).toEqual(['ops.md']);
    const verifiedOnly = await searchMemory({
      store,
      vectors,
      query: 'freeze',
      filter: { statuses: [MEMORY_STATUS.VERIFIED] },
      embedder: null,
    });
    expect(verifiedOnly.items).toEqual([]);
    vectors.close();
    store.close();
  });

  it('reads every document again once when a store from before the index opens', async () => {
    const { home, store } = await opened();
    store.putDocument('src_vault', 'ops.md', 's1', ['d1']);
    store.close();
    const db = new Database(memoryDatabasePathFor(home));
    db.pragma('user_version = 0');
    db.close();
    const again = SqliteMemoryStore.forHome(home);
    expect(again.documentStamps('src_vault').get('ops.md')).toBe('');
    again.putDocument('src_vault', 'ops.md', 's2', ['d1']);
    again.close();
    const third = SqliteMemoryStore.forHome(home);
    expect(third.documentStamps('src_vault').get('ops.md')).toBe('s2');
    third.close();
  });
});
