import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERED_AGENT_KIND,
  entryFor,
  HUB_TRANSPORT,
  NOTICE_KIND,
  readHub,
  SERVER_TROUBLE,
  ServerTroubles,
  type HubServer,
  type SecretStore,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerMcpCommand } from '../src/commands/mcp.command';
import { ServerTroubleWatch } from '../src/daemon/server-trouble-watch';
import { importServer } from '../src/mcp/hub-changes';
import { checkRemotes, handBack, REMOTE_VERDICT } from '../src/mcp/hub-repair';
import { syncHub } from '../src/mcp/hub-writer';
import { plainStyle } from '../src/style';

/**
 * A remote server that asks for a sign in can never connect behind the proxy, so it is found,
 * said in plain words, and handed back to the agent rather than left disconnected.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const SIGNS_IN = 'https://signs-in.example.com/mcp';
const OPEN = 'https://open.example.com/mcp';

/** One server that wants a sign in first and one that answers anybody. */
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === SIGNS_IN) return new Response('sign in', { status: 401 });
  if (init?.method === 'DELETE') return new Response(null, { status: 200 });
  const message = JSON.parse(String(init?.body)) as { id?: number; method: string };
  if (message.id === undefined) return new Response(null, { status: 202 });
  const result =
    message.method === 'initialize'
      ? { protocolVersion: '2025-06-18' }
      : { tools: [{ name: 'read_page' }] };
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

function proxied(name: string, url: string): { command: string; args: string[] } {
  return {
    command: 'memnox-mcp-proxy',
    args: [
      '--memnox-wrapped',
      '--memnox-hub',
      '--name',
      name,
      '--agent',
      CLAUDE,
      '--url',
      url,
    ],
  };
}

async function machine(servers: Record<string, unknown>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-repair-'));
  await writeFile(
    join(home, '.claude.json'),
    `${JSON.stringify({ mcpServers: servers, theme: 'dark' }, null, 2)}\n`,
  );
  return home;
}

async function serversOf(home: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  return parsed.mcpServers;
}

interface Ran {
  interactive?: boolean;
  confirm?: boolean;
  /** One answer per question, for a run that is asked more than one thing. */
  answers?: (question: string) => boolean;
  secrets?: SecretStore;
}

function memory(): SecretStore {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    remove: async (name) => void held.delete(name),
  };
}

async function repair(args: string[], home: string, ran: Ran = {}): Promise<string> {
  const out = new RecordedOutput();
  const program = new Command();
  registerMcpCommand(program, new CliContext(out, plainStyle), {
    home: () => home,
    resolveBinary: () => true,
    interactive: () => ran.interactive ?? false,
    confirm: async (question) => ran.answers?.(question) ?? ran.confirm ?? true,
    fetch: fetcher,
    secrets: ran.secrets ?? memory(),
    waitMs: 50,
    listen: async () => ({
      redirectUri: 'http://127.0.0.1:5000/callback',
      answer: async () => ({ error: 'access_denied' }),
      reply: () => undefined,
      close: async () => undefined,
    }),
    open: async () => true,
  });
  await program.parseAsync(['mcp', 'repair', ...args], { from: 'user' });
  return out.text;
}

describe('memnox mcp repair', () => {
  it('says which server asks for a sign in and which one connects', async () => {
    const home = await machine({
      videos: proxied('videos', SIGNS_IN),
      pages: proxied('pages', OPEN),
    });

    const checked = await checkRemotes(home, { fetch: fetcher });

    expect(checked.map((each) => [each.name, each.verdict, each.agents])).toEqual([
      ['videos', REMOTE_VERDICT.SIGN_IN, [CLAUDE]],
      ['pages', REMOTE_VERDICT.WORKING, [CLAUDE]],
    ]);
  });

  it('hands a line whose hub record is gone back as the address, and leaves the rest alone', async () => {
    const home = await machine({
      videos: proxied('videos', SIGNS_IN),
      pages: proxied('pages', OPEN),
    });

    const said = await repair(['--yes'], home);

    expect(await serversOf(home)).toEqual({
      videos: { type: 'http', url: SIGNS_IN },
      pages: proxied('pages', OPEN),
    });
    expect(said).toContain('videos  needs a sign in');
    expect(said).toContain('videos  Claude Code now reaches it and signs in itself');
    expect(said).toContain('sign in when it asks');
  });

  it('changes nothing when nobody is there to ask and --yes was not given', async () => {
    const home = await machine({ videos: proxied('videos', SIGNS_IN) });

    const said = await repair([], home);

    expect(await serversOf(home)).toEqual({ videos: proxied('videos', SIGNS_IN) });
    expect(said).toContain('memnox mcp repair --yes');
  });

  it('changes nothing when the person says no', async () => {
    const home = await machine({ videos: proxied('videos', SIGNS_IN) });

    const said = await repair([], home, { interactive: true, confirm: false });

    expect(await serversOf(home)).toEqual({ videos: proxied('videos', SIGNS_IN) });
    expect(said).toContain('Nothing was changed.');
  });

  it('offers the sign in through Memnox first, and hands back only what that did not mend', async () => {
    const home = await machine({ videos: proxied('videos', SIGNS_IN) });
    const asked: string[] = [];

    const said = await repair([], home, {
      interactive: true,
      answers: (question) => {
        asked.push(question.split('?')[0] ?? '');
        return true;
      },
    });

    expect(asked).toEqual([
      'Sign in now, one at a time',
      'Hand them back to your agents',
    ]);
    expect(said).toContain('takes sign ins only from apps it already knows');
    expect(await serversOf(home)).toEqual({ videos: { type: 'http', url: SIGNS_IN } });
    expect(said).toContain('1 server(s) handed back.');
  });

  it('hands nothing back when the person wants neither', async () => {
    const home = await machine({ videos: proxied('videos', SIGNS_IN) });

    const said = await repair([], home, { interactive: true, answers: () => false });

    expect(await serversOf(home)).toEqual({ videos: proxied('videos', SIGNS_IN) });
    expect(said).toContain('Nothing was changed.');
  });

  it('leaves a server that refused a credential for the person to replace', async () => {
    const keyed = proxied('videos', SIGNS_IN);
    keyed.args.push('--header', 'Authorization: Bearer memnox-secret:videos');
    const home = await machine({ videos: keyed });

    const checked = await checkRemotes(home, {
      fetch: fetcher,
      secrets: {
        get: async () => 'held',
        set: async () => undefined,
        remove: async () => undefined,
      },
    });

    expect(checked[0]?.verdict).toBe(REMOTE_VERDICT.CREDENTIAL);
  });

  it('keeps a hub server and marks it as the agent own to reach, so a later sync agrees', async () => {
    const server: HubServer = {
      name: 'videos',
      transport: HUB_TRANSPORT.HTTP,
      url: SIGNS_IN,
      env: {},
      secrets: {},
    };
    const home = await machine({});
    await syncHub(home, {
      version: 1,
      servers: [server],
      assignments: [{ server: 'videos', agent: CLAUDE }],
      written: [],
    });
    expect(await serversOf(home)).toEqual({ videos: entryFor(server, CLAUDE) });
    await new ServerTroubles(home).note({
      server: 'videos',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at: '2026-11-16T10:00:00.000Z',
    });

    const done = await handBack(home, ['videos']);

    expect(done.handed).toEqual([{ name: 'videos', agents: [CLAUDE] }]);
    expect(await serversOf(home)).toEqual({ videos: { type: 'http', url: SIGNS_IN } });
    const hub = await readHub(home);
    expect(hub.servers[0]?.direct).toBe(true);
    expect(await new ServerTroubles(home).all()).toEqual([]);
    const again = await syncHub(home, hub);
    expect(again.files).toEqual([]);
  });
});

describe('importing a server the agent signs in to', () => {
  it('leaves the person own line exactly as it was and says why', async () => {
    const home = await machine({ videos: { type: 'http', url: SIGNS_IN } });
    const before = await readFile(join(home, '.claude.json'), 'utf8');

    const changed = await importServer(
      home,
      { name: 'videos', agent: CLAUDE },
      { fetch: fetcher },
    );

    expect(changed).toEqual({
      refused:
        'videos signs you in through Claude Code, so it stays as you set it up and keeps working. Its calls are not ruled on. To rule on them, run "memnox mcp signin videos" and take it in again.',
    });
    expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(before);
  });

  it('still takes in a remote server that answers anybody, behind the proxy', async () => {
    const home = await machine({ pages: { type: 'http', url: OPEN } });

    const changed = await importServer(
      home,
      { name: 'pages', agent: CLAUDE },
      { fetch: fetcher },
    );

    expect('synced' in changed).toBe(true);
    expect(await serversOf(home)).toEqual({ pages: proxied('pages', OPEN) });
  });

  it('mends a line already behind the proxy by taking it in as the agent own to reach', async () => {
    const home = await machine({ videos: proxied('videos', SIGNS_IN) });

    await importServer(home, { name: 'videos', agent: CLAUDE }, { fetch: fetcher });

    expect(await serversOf(home)).toEqual({ videos: { type: 'http', url: SIGNS_IN } });
  });
});

describe('telling a person a server would not connect', () => {
  it('says it once, with why and what to run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-trouble-watch-'));
    const watch = new ServerTroubleWatch(home, '2026-11-16T09:00:00.000Z');
    await new ServerTroubles(home).note({
      server: 'videos',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at: '2026-11-16T10:00:00.000Z',
    });

    const first = await watch.look('2026-11-16T10:00:05.000Z');
    const second = await watch.look('2026-11-16T10:00:15.000Z');

    expect(first.map((each) => [each.notice, each.summary])).toEqual([
      [
        NOTICE_KIND.SERVER_TROUBLE,
        'videos is disconnected in Claude Code because it asks for a sign in. Run "memnox mcp signin videos" to sign in through Memnox and keep its calls ruled on, or "memnox mcp repair" to hand it back to Claude Code.',
      ],
    ]);
    expect(second).toEqual([]);
  });

  it('stays quiet about trouble from before anybody was listening', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-trouble-watch-'));
    await new ServerTroubles(home).note({
      server: 'videos',
      kind: SERVER_TROUBLE.UNREACHABLE,
      at: '2026-11-16T08:00:00.000Z',
    });

    const watch = new ServerTroubleWatch(home, '2026-11-16T09:00:00.000Z');

    expect(await watch.look('2026-11-16T10:00:00.000Z')).toEqual([]);
  });
});

describe('never trading a working server for one that might not connect', () => {
  it('leaves a server that did not answer exactly as it was', async () => {
    const home = await machine({
      quiet: { type: 'http', url: 'https://quiet.example.com/mcp' },
    });
    const before = await readFile(join(home, '.claude.json'), 'utf8');
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;

    const changed = await importServer(
      home,
      { name: 'quiet', agent: CLAUDE },
      { fetch: down },
    );

    expect(changed).toEqual({
      refused:
        'quiet did not answer Memnox just now, so it stays as you set it up and nothing was changed. Try again once it is reachable.',
    });
    expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(before);
  });

  it('puts every remote server back as its address when the proxy is taken away', async () => {
    const home = await machine({
      videos: proxied('videos', SIGNS_IN),
      pages: proxied('pages', OPEN),
      local: {
        command: 'memnox-mcp-proxy',
        args: ['--memnox-wrapped', '--name', 'local', '--', 'node', 's.js'],
      },
    });
    const out = new RecordedOutput();
    const program = new Command();
    registerMcpCommand(program, new CliContext(out, plainStyle), {
      home: () => home,
      project: () => home,
      resolveBinary: () => true,
    });

    await program.parseAsync(['mcp', 'unwrap'], { from: 'user' });

    expect(await serversOf(home)).toEqual({
      videos: { type: 'http', url: SIGNS_IN },
      pages: { type: 'http', url: OPEN },
      local: { command: 'node', args: ['s.js'] },
    });
    expect(out.text).toContain('3 server(s) restored.');
  });
});
