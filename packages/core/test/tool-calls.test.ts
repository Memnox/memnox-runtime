import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CALL_SKIPPED,
  callContent,
  callSourceIdOf,
  keepToolCall,
  MEMORY_SCOPE,
  MEMORY_SOURCE_KIND,
  memorySourceFor,
  MOST_CALL_CHARS,
  SqliteMemoryStore,
  TOOL_CALL_VIA,
} from '../src/index';

const AT = '2026-10-31T09:00:00.000Z';

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-calls-'));
}

describe("an agent's calls kept as the person's own memory", () => {
  it('reads an MCP answer as its text, masks credentials and keeps no more than the cap', () => {
    const text = callContent({
      content: [
        { type: 'text', text: 'Authorization: Bearer abcdefghijklmnop1234 done' },
      ],
    });
    expect(text).toContain('done');
    expect(text).not.toContain('abcdefghijklmnop1234');
    expect(callContent('x'.repeat(MOST_CALL_CHARS * 2))).toHaveLength(MOST_CALL_CHARS);
  });

  it('keeps one source per server, personal and untrusted, and reads each call as a passage by its agent', async () => {
    const at = await home();
    const call = {
      via: TOOL_CALL_VIA.MCP,
      agent: 'codex',
      sessionId: 's1',
      server: 'linear',
      tool: 'get_issue',
      at: AT,
      result: 'The billing service owns retries.',
    };
    await keepToolCall(at, call);
    await keepToolCall(at, { ...call, result: 'Second answer.' });
    const store = SqliteMemoryStore.forHome(at);
    const sources = store.sources();
    store.close();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: callSourceIdOf(TOOL_CALL_VIA.MCP, 'linear'),
      kind: MEMORY_SOURCE_KIND.MCP_CALLS,
      scope: MEMORY_SCOPE.PERSONAL,
      trust: 'tainted',
    });
    const [record] = sources;
    if (record === undefined) throw new Error('a call keeps its source');
    const source = memorySourceFor(record, { secret: async () => undefined, fetch });
    const listed = (await source?.list()) ?? [];
    expect(listed).toHaveLength(2);
    const [first] = listed;
    if (first === undefined) throw new Error('a kept call is listed');
    const read = await source?.read(first);
    expect(read?.passages[0]).toMatchObject({
      by: 'codex',
      heading: 'codex called get_issue on linear',
    });
  });

  it('keeps nothing the data rules class restricted, and nothing empty', async () => {
    const at = await home();
    const base = {
      via: TOOL_CALL_VIA.APP,
      agent: 'codex',
      app: 'stripe',
      tool: 'STRIPE_GET_CHARGE',
      at: AT,
    };
    expect(
      await keepToolCall(at, { ...base, result: 'charge 4111 1111 1111 1111 today' }),
    ).toEqual({
      skipped: CALL_SKIPPED.RESTRICTED,
    });
    expect(await keepToolCall(at, { ...base, result: '' })).toEqual({
      skipped: CALL_SKIPPED.EMPTY,
    });
    expect(await readdir(at)).toEqual([]);
  });
});
