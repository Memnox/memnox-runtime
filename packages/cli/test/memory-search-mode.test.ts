import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_SEARCH_MODE,
  MEMNOX_HOME,
  SqliteMemoryStore,
  type DaemonRequest,
  type EmbeddingPort,
} from '@memnox/core';
import { memoryAnswer } from '../src/daemon/memory-answer';
import { embedderFor, ollamaEmbedder } from '../src/memory/ollama-embedding';

/**
 * The memory search method says how it searched: keyword alone while semantic search is off, and
 * fused with a local embedding model once the person named one in the config.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

async function homeWithFact(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-search-mode-'));
  const store = SqliteMemoryStore.forHome(home);
  store.add(
    {
      kind: MEMORY_KIND.FACT,
      statement: 'We never deploy on Fridays.',
      subject: 'deploys',
      scope: MEMORY_SCOPE.PERSONAL,
      origin: MEMORY_ORIGIN.PERSON,
      tainted: false,
      evidence: [],
    },
    NOW.toISOString(),
  );
  store.close();
  return home;
}

function search(home: string, embedder: EmbeddingPort | null) {
  return memoryAnswer(
    home,
    {
      id: 1,
      method: DAEMON_METHOD.MEMORY_SEARCH,
      memoryQuery: 'friday',
    } as DaemonRequest,
    { now: NOW, embedder },
  );
}

describe('the memory search method', () => {
  it('says it searched by keyword while semantic search is off', async () => {
    const answer = await search(await homeWithFact(), null);

    expect(answer.memorySearchMode).toBe(MEMORY_SEARCH_MODE.KEYWORD);
    expect(answer.memorySearchNote).toBeUndefined();
    expect(answer.memoryFacts?.items).toHaveLength(1);
  });

  it('says it searched by meaning when a local model answered', async () => {
    const model: EmbeddingPort = {
      model: 'fake-embed',
      embed: async (texts) => texts.map(() => [1, 0]),
    };
    const answer = await search(await homeWithFact(), model);

    expect(answer.memorySearchMode).toBe(MEMORY_SEARCH_MODE.SEMANTIC);
    expect(answer.memoryFacts?.items).toHaveLength(1);
  });
});

describe('the Ollama embedding adapter', () => {
  it('posts the texts to /api/embed and reads one vector per text', async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ model: 'm', embeddings: [[0.1, 0.2]] }), {
        status: 200,
      });
    }) as typeof fetch;
    const port = ollamaEmbedder({
      model: 'nomic-embed-text',
      url: 'http://127.0.0.1:11434',
      fetch: fetcher,
    });

    expect(await port?.embed(['hello'])).toEqual([[0.1, 0.2]]);
    expect(sent).toEqual([
      {
        url: 'http://127.0.0.1:11434/api/embed',
        body: { model: 'nomic-embed-text', input: ['hello'] },
      },
    ]);
  });

  it('throws when the server refuses, so search falls back to keyword', async () => {
    const fetcher = (async () =>
      new Response('model not found', { status: 404 })) as typeof fetch;
    const port = ollamaEmbedder({
      model: 'x',
      url: 'http://localhost:11434',
      fetch: fetcher,
    });

    await expect(port?.embed(['hello'])).rejects.toThrow('it answered 404');
  });

  it('is off until the config names a model', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-embed-config-'));
    expect(await embedderFor(home)).toBeNull();

    await mkdir(join(home, MEMNOX_HOME), { recursive: true });
    await writeFile(
      join(home, MEMNOX_HOME, 'config.toml'),
      'mode = "observe"\nembeddingModel = "nomic-embed-text"\n',
    );
    expect((await embedderFor(home))?.model).toBe('nomic-embed-text');
  });
});
