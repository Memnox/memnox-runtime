import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DECISION_EFFECT, LocalGate, type MemnoxEvent } from '@memnox/core';
import { McpFirewall } from '../src/firewall';
import { parseFirewallArgs } from '../src/firewall-args';
import { EventFraming, HttpUpstream } from '../src/http-upstream';

const URL = 'https://mcp.example.com/mcp';
// Assembled at runtime, so no credential is written in the source.
const TOKEN = ['tok', 'en', '-', 'value'].join('');

interface Posted {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A server that answers each post from a handler, and keeps what it was sent. */
function fakeServer(answer: (body: string, index: number) => Response): {
  fetch: typeof fetch;
  posted: Posted[];
} {
  const posted: Posted[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    posted.push({
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      ...(body === undefined ? {} : { body }),
    });
    return answer(body ?? '', posted.length - 1);
  }) as typeof fetch;
  return { fetch: fetcher, posted };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function upstreamWith(fetcher: typeof fetch, extra: { most?: number } = {}) {
  const lines: string[] = [];
  const logged: string[] = [];
  const upstream = new HttpUpstream({
    url: URL,
    headers: { Authorization: `Bearer ${TOKEN}` },
    name: 'github',
    onLine: (line) => lines.push(line),
    log: (message) => logged.push(message),
    fetch: fetcher,
    ...(extra.most === undefined ? {} : { mostResponseBytes: extra.most }),
  });
  return { upstream, lines, logged };
}

const INITIALIZE = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n';

describe('a streamable HTTP server reached through the proxy', () => {
  it('carries the session the server named, and its protocol version, on every post after', async () => {
    const server = fakeServer((_body, index) =>
      index === 0
        ? json(
            { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
            { 'mcp-session-id': 'ses-1' },
          )
        : json({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    );
    const { upstream, lines } = upstreamWith(server.fetch);

    upstream.send(INITIALIZE);
    upstream.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    await upstream.close();

    expect(server.posted[1]?.headers['mcp-session-id']).toBe('ses-1');
    expect(server.posted[1]?.headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(server.posted[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(lines.map((line) => JSON.parse(line).id)).toEqual([1, 2]);
    expect(server.posted.at(-1)?.method).toBe('DELETE');
  });

  it('reads every message an event stream carries', async () => {
    const stream = [
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n',
      'data: {"jsonrpc":"2.0","id":1,\ndata: "result":{}}\n\n',
    ].join('');
    const server = fakeServer(
      () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const { upstream, lines } = upstreamWith(server.fetch);

    upstream.send(INITIALIZE);
    await upstream.close();

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: '2.0', method: 'notifications/progress' },
      { jsonrpc: '2.0', id: 1, result: {} },
    ]);
  });

  it('answers a notification it accepted with nothing', async () => {
    const server = fakeServer(() => new Response(null, { status: 202 }));
    const { upstream, lines } = upstreamWith(server.fetch);

    upstream.send('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await upstream.close();

    expect(lines).toEqual([]);
  });

  it('answers a request the server refused with an error, and never says a header value', async () => {
    const server = fakeServer(() => new Response('no', { status: 401 }));
    const { upstream, lines, logged } = upstreamWith(server.fetch);

    upstream.send(INITIALIZE);
    await upstream.close();

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      id: 1,
      error: { message: 'github answered 401' },
    });
    expect([...lines, ...logged].join('\n')).not.toContain(TOKEN);
  });

  it('gives up an answer past its bound rather than holding it', async () => {
    const server = fakeServer(() =>
      json({ jsonrpc: '2.0', id: 1, result: { big: 'x'.repeat(4_096) } }),
    );
    const { upstream, lines } = upstreamWith(server.fetch, { most: 1_024 });

    upstream.send(INITIALIZE);
    await upstream.close();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}').error.message).toContain('over 1024 bytes');
  });

  it('answers a server it could not reach, and refuses to send once closed', async () => {
    const down = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    const { upstream, lines } = upstreamWith(down);

    upstream.send(INITIALIZE);
    await upstream.close();

    expect(JSON.parse(lines[0] ?? '{}').error.message).toContain('could not be reached');
    expect(upstream.send(INITIALIZE)).toBe(false);
  });
});

describe('event stream framing', () => {
  it('joins an event cut across chunks', () => {
    const framing = new EventFraming();

    expect(framing.push('data: {"a"')).toEqual([]);
    expect(framing.push(':1}\r\n\r\ndata: tail')).toEqual(['{"a":1}']);
    expect(framing.end()).toEqual(['tail']);
  });
});

describe('the proxy flags for a remote server', () => {
  it('reads an address and its headers in place of a command', () => {
    expect(
      parseFirewallArgs([
        '--name',
        'github',
        '--url',
        URL,
        '--header',
        'Authorization: Bearer memnox-secret:github',
        '--header',
        'X-Team:core',
      ]),
    ).toEqual({
      serverName: 'github',
      command: [],
      url: URL,
      headers: { Authorization: 'Bearer memnox-secret:github', 'X-Team': 'core' },
    });
  });

  it('refuses both a command and an address, and a header that is not Name: value', () => {
    expect(parseFirewallArgs(['--url', URL, '--', 'npx', 'server'])).toBeNull();
    expect(parseFirewallArgs(['--url', URL, '--header', 'nonsense'])).toEqual({
      missingValueFor: '--header',
    });
  });
});

describe('the firewall in front of a remote server', () => {
  const gate = new LocalGate(
    [
      {
        name: 'no-deleting-repos',
        match: { actions: ['mcp.delete_repo', 'mcp.github.delete_repo'] },
        decision: { effect: DECISION_EFFECT.DENY, reason: 'repositories stay' },
      },
    ],
    { agentName: 'claude-code' },
  );

  async function run(lines: string[]) {
    const server = fakeServer((body) => {
      const id = JSON.parse(body).id;
      return json({ jsonrpc: '2.0', id, result: { content: [] } });
    });
    const rows: MemnoxEvent[] = [];
    const written: string[] = [];
    const input = new EventEmitter();
    const exited = new Promise<number>((resolve) => {
      new McpFirewall({
        command: [],
        remote: { url: URL, headers: {} },
        serverName: 'github',
        gate,
        agent: 'claude-code',
        log: () => undefined,
        ledger: { append: async (row: MemnoxEvent) => void rows.push(row) } as never,
      }).start({
        input,
        exit: resolve,
        fetch: server.fetch,
        output: (payload) => written.push(payload),
      });
    });
    for (const line of lines) input.emit('data', Buffer.from(`${line}\n`));
    input.emit('end');
    return { code: await exited, posted: server.posted, written, rows };
  }

  it('rules on a call before it is posted, and keeps a row for each call', async () => {
    const { code, posted, written, rows } = await run([
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"delete_repo","arguments":{}}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_issue","arguments":{}}}',
    ]);

    expect(code).toBe(0);
    expect(
      posted.flatMap((each) => (each.body === undefined ? [] : [each.body])),
    ).toEqual([expect.stringContaining('get_issue')]);
    const answers = written.map((line) => JSON.parse(line));
    expect(answers.find((each) => each.id === 1).result.isError).toBe(true);
    expect(answers.find((each) => each.id === 2).result).toEqual({ content: [] });
    expect(rows.map((row) => [row.operation, row.effect])).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('delete_repo'), DECISION_EFFECT.DENY],
        [expect.stringContaining('get_issue'), DECISION_EFFECT.ALLOW],
      ]),
    );
  });
});
