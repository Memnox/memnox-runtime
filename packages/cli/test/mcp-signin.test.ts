import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERED_AGENT_KIND,
  entryFor,
  HUB_TRANSPORT,
  readHub,
  RemoteSignIns,
  SERVER_TROUBLE,
  ServerTroubles,
  type HubServer,
  type RemoteSignIn,
  type SecretStore,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerMcpCommand } from '../src/commands/mcp.command';
import type { CallbackAnswer } from '../src/mcp/callback-listener';
import { SIGN_IN_PAGE, signInPage, type SignInPage } from '../src/mcp/callback-page';
import { syncHub } from '../src/mcp/hub-writer';
import { plainStyle } from '../src/style';

/**
 * `memnox mcp signin`: Memnox signs in to a remote server in the person's browser and keeps the
 * token, so the server connects behind the proxy. It never costs a sign in that was already there.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const SERVER = 'https://videos.example.com/mcp';
const ORIGIN = 'https://videos.example.com';
const REDIRECT = 'http://127.0.0.1:5000/callback';

interface Site {
  /** The token the server takes; anything else is refused. */
  good: string;
  /** Absent, the server registers no new client. */
  registers?: boolean;
  /** The token the sign in hands out. */
  issues?: string;
}

/** A remote server that wants a sign in, with the sign in pages it publishes. */
function site(config: Site): typeof fetch {
  const page = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const at = String(url);
    if (at === `${ORIGIN}/register`)
      return config.registers === false
        ? page({}, 404)
        : page({ client_id: 'memnox-1' }, 201);
    if (at === `${ORIGIN}/token`)
      return page({ access_token: config.issues ?? config.good, refresh_token: 'renew' });
    if (at !== SERVER) return page({}, 404);
    const sent = (init?.headers as Record<string, string>)['Authorization'];
    if (sent !== `Bearer ${config.good}`) return new Response('', { status: 401 });
    if (init?.method === 'DELETE') return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-06-18' }
        : { tools: [{ name: 'make_video' }] };
    return page({ jsonrpc: '2.0', id: message.id, result });
  }) as typeof fetch;
}

function memory(): SecretStore {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    remove: async (name) => void held.delete(name),
  };
}

const PROXIED = {
  command: 'memnox-mcp-proxy',
  args: [
    '--memnox-wrapped',
    '--memnox-hub',
    '--name',
    'videos',
    '--agent',
    CLAUDE,
    '--url',
    SERVER,
  ],
};

async function machine(servers: Record<string, unknown>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-signin-'));
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }));
  return home;
}

interface Run {
  home: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  /** What the browser sends back; the state is filled in from the page that was opened. */
  approves?: (state: string) => CallbackAnswer;
  /** Where the page the browser was shown is kept. */
  pages?: SignInPage[];
  /** Whether nobody ever approves, and the person presses Enter instead. */
  skips?: boolean;
}

async function signin(run: Run): Promise<{ text: string; opened: string[] }> {
  const out = new RecordedOutput();
  const opened: string[] = [];
  let approve: (answer: CallbackAnswer) => void = () => undefined;
  const answered = new Promise<CallbackAnswer>((done) => {
    approve = done;
  });
  const program = new Command();
  registerMcpCommand(program, new CliContext(out, plainStyle), {
    home: () => run.home,
    resolveBinary: () => true,
    secrets: run.secrets,
    fetch: run.fetch,
    waitMs: 50,
    listen: async () => ({
      redirectUri: REDIRECT,
      answer: () => answered,
      reply: (page) => run.pages?.push(page),
      close: async () => undefined,
    }),
    ...(run.skips === true
      ? { skip: () => ({ pressed: Promise.resolve(), release: () => undefined }) }
      : {}),
    open: async (url) => {
      opened.push(url);
      if (run.skips === true) return true;
      const state = new URL(url).searchParams.get('state') ?? '';
      const reply = run.approves ?? ((given: string) => ({ code: 'abc', state: given }));
      approve(reply(state));
      return true;
    },
  });
  await program.parseAsync(['mcp', 'signin', 'videos'], { from: 'user' });
  return { text: out.text, opened };
}

const KEPT: RemoteSignIn = {
  url: SERVER,
  tokenEndpoint: `${ORIGIN}/token`,
  resource: SERVER,
  client: { clientId: 'memnox-0' },
  accessToken: 'earlier',
};

describe('memnox mcp signin', () => {
  it('signs in, keeps the token, and forgets the trouble it settled', async () => {
    const home = await machine({ videos: PROXIED });
    const secrets = memory();
    await new ServerTroubles(home).note({
      server: 'videos',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at: '2026-11-16T10:00:00.000Z',
    });

    const { text, opened } = await signin({
      home,
      secrets,
      fetch: site({ good: 'fresh' }),
    });

    expect(opened[0]).toContain(`${ORIGIN}/authorize?`);
    expect(text).toContain('videos is connected, and Memnox rules on its calls.');
    expect((await new RemoteSignIns(secrets, home).get(SERVER))?.accessToken).toBe(
      'fresh',
    );
    expect(await new ServerTroubles(home).all()).toEqual([]);
  });

  it('leaves a server that is already connected exactly as it is', async () => {
    const home = await machine({ videos: PROXIED });
    const secrets = memory();
    await new RemoteSignIns(secrets, home).set({ ...KEPT, accessToken: 'fresh' });

    const { text, opened } = await signin({
      home,
      secrets,
      fetch: site({ good: 'fresh' }),
    });

    expect(opened).toEqual([]);
    expect(text).toContain('videos is already connected.');
  });

  it('puts back the sign in that was there when a new one does not connect', async () => {
    const home = await machine({ videos: PROXIED });
    const secrets = memory();
    await new RemoteSignIns(secrets, home).set(KEPT);

    const { text } = await signin({
      home,
      secrets,
      fetch: site({ good: 'never-issued', issues: 'useless' }),
    });

    expect(text).toContain(
      'took the sign in and still would not answer, so the sign in was not kept.',
    );
    expect(await new RemoteSignIns(secrets, home).get(SERVER)).toEqual(KEPT);
  });

  it('says so, and names the way out, where the server registers nobody new', async () => {
    const home = await machine({ videos: PROXIED });

    const { text, opened } = await signin({
      home,
      secrets: memory(),
      fetch: site({ good: 'fresh', registers: false }),
    });

    expect(opened).toEqual([]);
    expect(text).toContain('takes sign ins only from apps it already knows');
    expect(text).toContain('"memnox mcp repair" hands it back to your agent');
    expect(text).toContain('memnox mcp signin videos --client-id <id>');
  });

  it('uses nothing from an answer that belongs to another sign in', async () => {
    const home = await machine({ videos: PROXIED });
    const secrets = memory();

    const { text } = await signin({
      home,
      secrets,
      fetch: site({ good: 'fresh' }),
      approves: () => ({ code: 'abc', state: 'somebody-else' }),
    });

    expect(text).toContain(
      'The answer did not belong to this sign in, so it was not used.',
    );
    expect(await new RemoteSignIns(secrets, home).get(SERVER)).toBeNull();
  });

  it('puts a server left for the agent back behind Memnox once Memnox can sign in', async () => {
    const server: HubServer = {
      name: 'videos',
      transport: HUB_TRANSPORT.HTTP,
      url: SERVER,
      direct: true,
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

    const { text } = await signin({
      home,
      secrets: memory(),
      fetch: site({ good: 'fresh' }),
    });

    const { direct: _direct, ...proxied } = server;
    const config = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers).toEqual({ videos: entryFor(proxied, CLAUDE) });
    expect((await readHub(home)).servers[0]?.direct).toBeUndefined();
    expect(text).toContain('videos is behind Memnox again, so its calls are ruled on.');
  });
});

describe('what the browser is shown once the person approves', () => {
  it('says connected only once the server answered with the sign in', async () => {
    const home = await machine({ videos: PROXIED });
    const pages: SignInPage[] = [];

    await signin({ home, secrets: memory(), fetch: site({ good: 'fresh' }), pages });

    expect(pages).toEqual([{ kind: SIGN_IN_PAGE.CONNECTED, server: 'videos' }]);
  });

  it('says why when the server would not answer with it', async () => {
    const home = await machine({ videos: PROXIED });
    const pages: SignInPage[] = [];

    await signin({
      home,
      secrets: memory(),
      fetch: site({ good: 'never-issued', issues: 'useless' }),
      pages,
    });

    expect(pages).toEqual([
      {
        kind: SIGN_IN_PAGE.FAILED,
        server: 'videos',
        detail:
          'videos took the sign in and still would not answer, so the sign in was not kept.',
      },
    ]);
  });

  it('carries the Memnox mark and never draws a server name as markup', () => {
    const html = signInPage({
      kind: SIGN_IN_PAGE.FAILED,
      server: '<b>evil</b>',
      detail: 'it said "no"',
    });

    expect(html).toContain('<svg class="mark"');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt; is not connected');
    expect(html).toContain('it said &quot;no&quot;');
    expect(html).not.toContain('<b>evil</b>');
  });
});

describe('a sign in nobody finishes', () => {
  it('moves on when the person presses Enter, and changes nothing', async () => {
    const home = await machine({ videos: PROXIED });
    const secrets = memory();

    const { text } = await signin({
      home,
      secrets,
      fetch: site({ good: 'fresh' }),
      skips: true,
    });

    expect(text).toContain('videos was skipped, and nothing was changed.');
    expect(await new RemoteSignIns(secrets, home).get(SERVER)).toBeNull();
  });
});
