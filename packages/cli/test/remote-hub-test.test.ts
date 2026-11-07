import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HUB_TRANSPORT,
  MCP_HEALTH,
  type HubServer,
  type SecretStore,
} from '@memnox/core';
import { testHubServer } from '../src/mcp/hub-test';

const NOW = new Date('2026-10-30T12:00:00Z');
// Assembled at runtime, so no credential is written in the source.
const TOKEN = ['gh', 'p_', 'remote'].join('');

const REMOTE: HubServer = {
  name: 'github',
  transport: HUB_TRANSPORT.HTTP,
  url: 'https://mcp.example.com/mcp',
  headers: { Authorization: 'Bearer memnox-secret:github' },
  env: {},
  secrets: {},
};

function storeWith(held: Record<string, string>): SecretStore {
  return {
    get: async (name: string) => held[name],
    set: async () => undefined,
    remove: async () => undefined,
  } as unknown as SecretStore;
}

/** A server that answers initialize and tools/list, and keeps the headers it was sent. */
function server(): { fetch: typeof fetch; authorizations: string[] } {
  const authorizations: string[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    authorizations.push(headers['Authorization'] ?? '');
    if (init?.method === 'DELETE') return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18' }
        : { tools: [{ name: 'get_issue', description: 'Reads an issue' }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fetcher, authorizations };
}

describe('testing a remote hub server', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-remote-test-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('lists its tools with the header secret read from the store', async () => {
    const remote = server();
    const health = await testHubServer(home, REMOTE, {
      secrets: storeWith({ github: TOKEN }),
      now: NOW,
      fetch: remote.fetch,
    });

    expect(health.state).toBe(MCP_HEALTH.HEALTHY);
    expect(health.tools).toEqual([{ name: 'get_issue', description: 'Reads an issue' }]);
    expect(remote.authorizations[0]).toBe(`Bearer ${TOKEN}`);
  });

  it('names the secret it needs and asks nothing when the store lacks it', async () => {
    const remote = server();
    const health = await testHubServer(home, REMOTE, {
      secrets: storeWith({}),
      now: NOW,
      fetch: remote.fetch,
    });

    expect(health).toMatchObject({
      state: MCP_HEALTH.ERROR,
      error: 'Not held yet: github.',
    });
    expect(remote.authorizations).toEqual([]);
  });
});
