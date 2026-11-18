import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  DISCOVERED_AGENT_KIND,
  entryFor,
  HUB_TRANSPORT,
  HUB_VERSION,
  MCP_HEALTH,
  PROPOSAL_ANSWER,
  readHub,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SERVER_TROUBLE,
  ServerTroubles,
  type DaemonRequest,
  type DaemonResponse,
  type HubServer,
  type SecretStore,
  writeHubHealth,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { mcpHubAnswer } from '../src/daemon/mcp-hub-answer';
import type { CallbackAnswer } from '../src/mcp/callback-listener';
import { syncHub } from '../src/mcp/hub-writer';

/**
 * The two ways out the hub card offers for a server that asks for a sign in: signing in through
 * Memnox, answered at once and finished in the browser, and handing it back, which the person signs.
 */

const NOW = new Date('2026-11-16T10:00:00.000Z');
const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const ORIGIN = 'https://videos.example.com';
const SERVER = `${ORIGIN}/mcp`;

const VIDEOS: HubServer = {
  name: 'videos',
  transport: HUB_TRANSPORT.HTTP,
  url: SERVER,
  env: {},
  secrets: {},
};

/** A server that wants a sign in, registers a new client where `registers`, and takes the token it issues. */
function site(registers: boolean): typeof fetch {
  const page = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const at = String(url);
    if (at === `${ORIGIN}/register`)
      return registers ? page({ client_id: 'memnox-1' }, 201) : page({}, 404);
    if (at === `${ORIGIN}/token`) return page({ access_token: 'fresh' });
    if (at !== SERVER) return page({}, 404);
    const sent = (init?.headers as Record<string, string>)['Authorization'];
    if (sent !== 'Bearer fresh') return new Response('', { status: 401 });
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

interface Fixture {
  home: string;
  ask(request: Partial<DaemonRequest>, remote?: boolean): Promise<DaemonResponse>;
  /** Resolves once the sign in a press started has ended. */
  finished(): Promise<void>;
  signed(subject: string): string;
}

async function fixture(registers = true): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-hub-signin-'));
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  await syncHub(home, {
    version: HUB_VERSION,
    servers: [VIDEOS],
    assignments: [{ server: 'videos', agent: CLAUDE }],
    written: [],
  });
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  const secrets = memory();
  let running: Promise<void> = Promise.resolve();
  let id = 0;
  return {
    home,
    finished: () => running,
    ask: (request, remote = false) => {
      id += 1;
      let approve: (answer: CallbackAnswer) => void = () => undefined;
      const answered = new Promise<CallbackAnswer>((done) => {
        approve = done;
      });
      const full = { id, method: DAEMON_METHOD.HUB, ...request } as DaemonRequest;
      return mcpHubAnswer(home, full, {
        now: NOW,
        remote,
        secrets,
        fetch: site(registers),
        signIn: {
          waitMs: 50,
          listen: async () => ({
            redirectUri: 'http://127.0.0.1:5000/callback',
            answer: () => answered,
            reply: () => undefined,
            close: async () => undefined,
          }),
          open: async (url) => {
            approve({ code: 'abc', state: new URL(url).searchParams.get('state') ?? '' });
            return true;
          },
          running: (done) => {
            running = done;
          },
        },
      });
    },
    signed: (subject) =>
      sign(
        'sha256',
        Buffer.from(confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED)),
        privateKey,
      ).toString('base64'),
  };
}

async function serversOf(home: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  return parsed.mcpServers;
}

describe('signing in to a server from its hub card', () => {
  it('answers the press at once, and the card shows the tools once the browser is done', async () => {
    const at = await fixture();

    const pressed = await at.ask({
      method: DAEMON_METHOD.SIGN_IN,
      mcpServerName: 'videos',
    });
    await at.finished();
    const after = await at.ask({});

    expect(pressed.ok).toBe(true);
    expect(pressed.outcome).toContain('The sign in page of videos is opening');
    expect(after.mcpHub?.servers[0]).toMatchObject({
      governed: true,
      health: { state: MCP_HEALTH.HEALTHY },
      tools: [{ name: 'make_video' }],
    });
    expect(await serversOf(at.home)).toEqual({ videos: entryFor(VIDEOS, CLAUDE) });
  });

  it('puts the reason on the card where the server takes no new app', async () => {
    const at = await fixture(false);

    await at.ask({ method: DAEMON_METHOD.SIGN_IN, mcpServerName: 'videos' });
    await at.finished();
    const after = await at.ask({});

    expect(after.mcpHub?.servers[0]?.health).toMatchObject({
      state: MCP_HEALTH.ERROR,
      error: expect.stringContaining('takes sign ins only from apps it already knows'),
    });
  });

  it('is done at the computer and never from a phone', async () => {
    const at = await fixture();

    const pressed = await at.ask(
      { method: DAEMON_METHOD.SIGN_IN, mcpServerName: 'videos' },
      true,
    );

    expect(pressed.ok).toBe(false);
    expect(pressed.reason).toBe(
      'Sign in at the computer, since its browser is where the page opens.',
    );
    expect(remoteCapabilityFor(DAEMON_METHOD.SIGN_IN)).toBeNull();
  });

  it('tells the card why a server is disconnected, so it can offer the way out', async () => {
    const at = await fixture();
    await new ServerTroubles(at.home).note({
      server: 'videos',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at: NOW.toISOString(),
    });

    const view = await at.ask({});

    expect(view.mcpHub?.servers[0]?.trouble).toBe(SERVER_TROUBLE.SIGN_IN);
  });
});

describe('handing a server back from its hub card', () => {
  it('only proposes, and gives the server back once the person signs', async () => {
    const at = await fixture();

    const pressed = await at.ask({
      method: DAEMON_METHOD.HAND_BACK,
      mcpServerName: 'videos',
    });
    expect(pressed.proposed).toBeDefined();
    expect(await serversOf(at.home)).toEqual({ videos: entryFor(VIDEOS, CLAUDE) });
    expect(remoteCapabilityFor(DAEMON_METHOD.HAND_BACK)).toBe(REMOTE_CAPABILITY.ASK);

    const result = await confirmAnswer(at.home, {
      subject: pressed.proposed ?? '',
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: at.signed(pressed.proposed ?? ''),
      at: NOW.toISOString(),
    });

    expect(result).toMatchObject({ ok: true });
    expect(await serversOf(at.home)).toEqual({ videos: { type: 'http', url: SERVER } });
    expect((await readHub(at.home)).servers[0]?.direct).toBe(true);
    expect((await at.ask({})).mcpHub?.servers[0]?.governed).toBe(false);
  });

  it('never shows a test it cannot make once a server is handed back', async () => {
    const at = await fixture();
    const pressed = await at.ask({
      method: DAEMON_METHOD.HAND_BACK,
      mcpServerName: 'videos',
    });
    await confirmAnswer(at.home, {
      subject: pressed.proposed ?? '',
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: at.signed(pressed.proposed ?? ''),
      at: NOW.toISOString(),
    });
    await writeHubHealth(at.home, {
      videos: {
        state: MCP_HEALTH.ERROR,
        checkedAt: NOW.toISOString(),
        error: 'answered 401',
      },
    });

    const tested = await at.ask({ method: DAEMON_METHOD.TEST, mcpServerName: 'videos' });
    const view = await at.ask({});

    expect(tested.ok).toBe(false);
    expect(tested.reason).toBe(
      'Your agents sign in to videos and reach it themselves, so Memnox cannot test it. Sign in through Memnox to test it and rule on its calls.',
    );
    expect(view.mcpHub?.servers[0]?.health).toEqual({ state: MCP_HEALTH.UNKNOWN });
  });
});
