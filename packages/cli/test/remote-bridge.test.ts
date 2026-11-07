import { describe, expect, it } from 'vitest';
import { isOwnServer, planWrap, REMOTE_BRIDGE_ENV } from '@memnox/core';
import { createBridge, eventMessages } from '../src/mcp/remote-bridge';
import { managedBridgeFor } from '../src/agents/managed-shape';
import { withManagedServer } from '../src/agents/managed-server';

const URL = 'https://api.example.test/v1/workspaces/w/mcp';

interface Sent {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A workspace that names a session on initialize and answers each request as JSON or as an event stream. */
function workspace(
  sent: Sent[],
  stream = false,
): (url: string, init: RequestInit) => Promise<Response> {
  return (_url, init) => {
    const headers = init.headers as Record<string, string>;
    sent.push({
      method: init.method ?? 'GET',
      headers,
      body: init.body as string | undefined,
    });
    const message =
      init.body === undefined
        ? null
        : (JSON.parse(init.body as string) as { id?: number; method?: string });
    if (message?.id === undefined)
      return Promise.resolve(new Response(null, { status: 202 }));
    const answer =
      message.method === 'initialize'
        ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }
        : { jsonrpc: '2.0', id: message.id, result: { tools: [] } };
    const body = stream
      ? `event: message\ndata: ${JSON.stringify(answer)}\n\n`
      : JSON.stringify(answer);
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': stream ? 'text/event-stream' : 'application/json',
          ...(message.method === 'initialize' ? { 'mcp-session-id': 'ses-1' } : {}),
        },
      }),
    );
  };
}

describe('the bridge Claude Desktop starts to reach the workspace', () => {
  it('opens the session, then sends every later message in it with the version it agreed', async () => {
    const sent: Sent[] = [];
    const written: string[] = [];
    const bridge = createBridge({
      url: URL,
      authorization: 'Bearer t',
      write: (line) => written.push(line),
      relay: workspace(sent),
    });
    await Promise.all([
      bridge.handle(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      ),
      bridge.handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })),
    ]);
    expect(sent[0]?.headers['mcp-session-id']).toBeUndefined();
    expect(sent[1]?.headers['mcp-session-id']).toBe('ses-1');
    expect(sent[1]?.headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(sent.every((each) => each.headers.authorization === 'Bearer t')).toBe(true);
    expect(written.map((line) => (JSON.parse(line) as { id: number }).id)).toEqual([
      1, 2,
    ]);
    await bridge.close();
    expect(sent.at(-1)?.method).toBe('DELETE');
  });

  it('reads an answer the workspace sent as an event stream', async () => {
    const written: string[] = [];
    const bridge = createBridge({
      url: URL,
      authorization: 'Bearer t',
      write: (line) => written.push(line),
      relay: workspace([], true),
    });
    await bridge.handle(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }));
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({
      id: 7,
      result: { tools: [] },
    });
  });

  it('answers a request the workspace never got with an error, so the agent is not left waiting', async () => {
    const written: string[] = [];
    const bridge = createBridge({
      url: URL,
      authorization: 'Bearer t',
      write: (line) => written.push(line),
      relay: () => Promise.reject(new Error('offline')),
    });
    await bridge.handle(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call' }));
    await bridge.handle(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({
      id: 3,
      error: { code: -32000 },
    });
  });

  it('joins an event spread over several data lines into one message', () => {
    expect(eventMessages('data: {"id":1,\ndata: "result":{}}\n\n')).toEqual([
      { id: 1, result: {} },
    ]);
  });

  it('goes into Claude Desktop as a command with the credential in its environment, never on its command line', () => {
    const entry = managedBridgeFor(
      URL,
      'tok',
      { command: '/usr/local/bin/node', args: ['/m/dist/bin/mcp-remote.js'] },
      REMOTE_BRIDGE_ENV,
    );
    const rewritten = withManagedServer(
      '{\n  "mcpServers": {}\n}\n',
      'mcpServers',
      entry,
      'claude_desktop_config.json',
    );
    const written = JSON.parse(rewritten.next ?? '{}') as {
      mcpServers: { memnox: Record<string, unknown> };
    };
    expect(written.mcpServers.memnox).toEqual({
      command: '/usr/local/bin/node',
      args: ['/m/dist/bin/mcp-remote.js', URL],
      env: { [REMOTE_BRIDGE_ENV]: 'Bearer tok' },
    });
    expect(JSON.stringify(entry.args)).not.toContain('tok');
  });

  it('is never wrapped in the proxy, which would put Memnox in front of itself', () => {
    const entry = managedBridgeFor(
      URL,
      'tok',
      { command: 'node', args: ['mcp-remote.js'] },
      REMOTE_BRIDGE_ENV,
    );
    expect(isOwnServer(entry)).toBe(true);
    expect(planWrap({ memnox: entry }).wrap).toEqual([]);
  });

  it('is refused for a TOML or YAML config, which never belongs to Claude Desktop', () => {
    const entry = managedBridgeFor(
      URL,
      'tok',
      { command: 'node', args: [] },
      REMOTE_BRIDGE_ENV,
    );
    expect(withManagedServer('', 'mcp_servers', entry, 'config.toml').next).toBeNull();
  });
});
