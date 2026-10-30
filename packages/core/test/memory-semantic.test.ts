import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyConfigValue,
  cosine,
  DEFAULT_CONFIG,
  fuseRankings,
  isLoopbackUrl,
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_SEARCH_MODE,
  parseConfig,
  renderConfig,
  searchMemory,
  SqliteMemoryStore,
  SqliteMemoryVectors,
  validateConfigValue,
  type EmbeddingPort,
  type MemoryItem,
} from '../src/index';

/**
 * Memory searched by meaning as well as by keyword, through a local embedding model the person
 * turned on, and by keyword alone, saying so, when it is off or does not answer.
 */

const AT = '2026-10-30T09:00:00.000Z';

/** Three meanings, each with the words that carry it, so a test model can tell them apart. */
const MEANINGS: readonly (readonly string[])[] = [
  ['deploy', 'ship', 'shipping', 'release'],
  ['friday', 'fridays', 'weekend', 'saturday'],
  ['postgres', 'database', 'db'],
];

function fakeModel(calls: string[][] = []): EmbeddingPort {
  return {
    model: 'fake-embed',
    embed: async (texts) => {
      calls.push([...texts]);
      return texts.map((text) => {
        const words = text.toLowerCase().split(/[^a-z]+/);
        return MEANINGS.map((meaning) =>
          words.some((word) => meaning.includes(word)) ? 1 : 0,
        );
      });
    },
  };
}

async function seeded(): Promise<{
  home: string;
  store: SqliteMemoryStore;
  vectors: SqliteMemoryVectors;
  items: MemoryItem[];
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-semantic-'));
  const store = SqliteMemoryStore.forHome(home);
  const items = ['We never deploy on Fridays.', 'The database is Postgres 16.'].map(
    (statement) => {
      const outcome = store.add(
        {
          kind: MEMORY_KIND.FACT,
          statement,
          subject: 'ops',
          scope: MEMORY_SCOPE.PERSONAL,
          origin: MEMORY_ORIGIN.PERSON,
          tainted: false,
          evidence: [],
        },
        AT,
      );
      if (!('added' in outcome)) throw new Error('expected a new item');
      return outcome.added;
    },
  );
  return { home, store, vectors: SqliteMemoryVectors.forHome(home), items };
}

describe('semantic memory search', () => {
  it('finds by meaning what no keyword matches, and says it searched by meaning', async () => {
    const { store, vectors, items } = await seeded();
    const query = 'weekend shipping';
    expect(store.search(query, {})).toEqual([]);

    const found = await searchMemory({
      store,
      vectors,
      query,
      filter: {},
      embedder: fakeModel(),
    });

    expect(found.mode).toBe(MEMORY_SEARCH_MODE.SEMANTIC);
    expect(found.items.map((item) => item.id)).toEqual([items[0]?.id]);
  });

  it('embeds each item once, and again only when its words change', async () => {
    const { store, vectors, items } = await seeded();
    const calls: string[][] = [];
    const embedder = fakeModel(calls);
    const search = { store, vectors, query: 'database', filter: {}, embedder };

    await searchMemory(search);
    await searchMemory(search);
    store.edit(items[1]?.id ?? '', { statement: 'The database is Postgres 17.' });
    await searchMemory(search);

    const embeddedItems = calls.filter((texts) => texts[0] !== 'database');
    expect(embeddedItems).toEqual([
      ['We never deploy on Fridays.', 'The database is Postgres 16.'],
      ['The database is Postgres 17.'],
    ]);
  });

  it('is keyword only and says so when it is off or the model does not answer', async () => {
    const { store, vectors, items } = await seeded();
    const off = await searchMemory({
      store,
      vectors,
      query: 'postgres',
      filter: {},
      embedder: null,
    });
    expect(off).toEqual({ items: [items[1]], mode: MEMORY_SEARCH_MODE.KEYWORD });

    const down: EmbeddingPort = {
      model: 'nomic-embed-text',
      embed: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      },
    };
    const failed = await searchMemory({
      store,
      vectors,
      query: 'postgres',
      filter: {},
      embedder: down,
    });
    expect(failed.mode).toBe(MEMORY_SEARCH_MODE.KEYWORD);
    expect(failed.items).toEqual([items[1]]);
    expect(failed.note).toContain('nomic-embed-text did not answer');
  });

  it('ranks by cosine and fuses the two orders by place', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(fuseRankings(['a', 'b'], ['b', 'c'])).toEqual(['b', 'a', 'c']);
  });
});

describe('the embedding settings', () => {
  it('are off by default, and take an address on this machine only', () => {
    expect(DEFAULT_CONFIG.embeddingModel).toBeUndefined();
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(
      validateConfigValue('embeddingUrl', 'https://embed.example.com').error,
    ).toContain('on this machine');
    expect(
      parseConfig('embeddingUrl = "http://10.0.0.2:11434"').embeddingUrl,
    ).toBeUndefined();
  });

  it('read back as they were written, and clear when emptied', () => {
    const on = applyConfigValue(DEFAULT_CONFIG, 'embeddingModel', 'nomic-embed-text');
    expect(parseConfig(renderConfig(on))).toEqual(on);
    expect(applyConfigValue(on, 'embeddingModel', '').embeddingModel).toBeUndefined();
  });
});
