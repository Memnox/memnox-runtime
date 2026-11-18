import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvalUrl,
  discoverSignIn,
  exchangeCode,
  KeptSignIn,
  newSignInRequest,
  registerClient,
  RemoteSignIns,
  renewSignIn,
  signInAsked,
  type RemoteSignIn,
  type SecretStore,
} from '../src';

/**
 * Signing in to a remote server as its own published metadata says, and keeping the token fresh,
 * so a server that asks for a sign in stays connected behind the proxy.
 */

const SERVER = 'https://mcp.example.com/mcp';
const NOW = new Date('2026-11-16T10:00:00.000Z');

type Route = (init: RequestInit | undefined) => Response;

function web(routes: Record<string, Route>): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push(String(url));
    const route = routes[String(url)];
    return route === undefined ? new Response('', { status: 404 }) : route(init);
  }) as typeof fetch;
  return { fetch: fetcher, asked };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function memory(): SecretStore {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    remove: async (name) => void held.delete(name),
  };
}

const KEPT: RemoteSignIn = {
  url: SERVER,
  tokenEndpoint: 'https://auth.example.com/token',
  resource: SERVER,
  client: { clientId: 'memnox-1' },
  accessToken: 'first',
  refreshToken: 'renew-1',
  expiresAt: '2026-11-16T11:00:00.000Z',
};

describe('finding where a server signs people in', () => {
  it('hears a bare request refused, and where the server says to look', async () => {
    const { fetch } = web({
      [SERVER]: () =>
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
          },
        }),
    });

    expect(await signInAsked(SERVER, fetch)).toEqual({
      asked: true,
      metadata: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
    });
  });

  it('does not take a server that answers for one that wants a sign in', async () => {
    const { fetch } = web({ [SERVER]: () => json({}) });
    expect(await signInAsked(SERVER, fetch)).toEqual({ asked: false });
  });

  it('follows the published resource to the one who signs people in for it', async () => {
    const { fetch } = web({
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': () =>
        json({
          resource: SERVER,
          authorization_servers: ['https://auth.example.com'],
          scopes_supported: ['read'],
        }),
      'https://auth.example.com/.well-known/oauth-authorization-server': () =>
        json({
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
        }),
    });

    expect(await discoverSignIn(SERVER, fetch)).toEqual({
      authorization: 'https://auth.example.com/authorize',
      token: 'https://auth.example.com/token',
      registration: 'https://auth.example.com/register',
      resource: SERVER,
      scopes: ['read'],
    });
  });

  it('falls back to the server itself where nothing is published', async () => {
    const { fetch } = web({});
    expect(await discoverSignIn(SERVER, fetch)).toEqual({
      authorization: 'https://mcp.example.com/authorize',
      token: 'https://mcp.example.com/token',
      registration: 'https://mcp.example.com/register',
      resource: SERVER,
    });
  });

  it('never follows a sign in address that is not https', async () => {
    const { fetch } = web({
      'https://mcp.example.com/.well-known/oauth-authorization-server': () =>
        json({
          authorization_endpoint: 'http://evil.example.com/authorize',
          token_endpoint: 'https://mcp.example.com/token',
        }),
    });

    const found = await discoverSignIn(SERVER, fetch);
    expect(found?.authorization).toBe('https://mcp.example.com/authorize');
  });
});

describe('one sign in, from registering to the token', () => {
  const endpoints = {
    authorization: 'https://auth.example.com/authorize',
    token: 'https://auth.example.com/token',
    registration: 'https://auth.example.com/register',
    resource: SERVER,
  };

  it('registers a client that comes back to this machine', async () => {
    let sent: unknown;
    const { fetch } = web({
      'https://auth.example.com/register': (init) => {
        sent = JSON.parse(String(init?.body));
        return json({ client_id: 'memnox-1' }, 201);
      },
    });

    const client = await registerClient(
      endpoints,
      'http://127.0.0.1:5000/callback',
      fetch,
    );

    expect(client).toEqual({ clientId: 'memnox-1' });
    expect(sent).toMatchObject({
      redirect_uris: ['http://127.0.0.1:5000/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('answers null where the server registers nobody new', async () => {
    const { registration: _none, ...closed } = endpoints;
    expect(await registerClient(closed, 'http://127.0.0.1:1/callback', fetch)).toBeNull();
  });

  it('sends the person to approve with a proof key and the server the token is for', () => {
    const request = newSignInRequest('http://127.0.0.1:5000/callback');
    const page = new URL(approvalUrl(endpoints, { clientId: 'memnox-1' }, request));

    expect(page.origin + page.pathname).toBe('https://auth.example.com/authorize');
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'memnox-1',
      state: request.state,
      code_challenge: request.challenge,
      code_challenge_method: 'S256',
      resource: SERVER,
    });
    expect(request.verifier).not.toBe(request.challenge);
  });

  it('turns the approval into a sign in with the moment it runs out', async () => {
    let form = new URLSearchParams();
    const { fetch } = web({
      'https://auth.example.com/token': (init) => {
        form = new URLSearchParams(String(init?.body));
        return json({
          access_token: 'first',
          refresh_token: 'renew-1',
          expires_in: 3600,
        });
      },
    });
    const request = newSignInRequest('http://127.0.0.1:5000/callback');

    const signedIn = await exchangeCode(
      { url: SERVER, endpoints, client: { clientId: 'memnox-1' }, request, code: 'abc' },
      fetch,
      NOW,
    );

    expect(signedIn).toEqual(KEPT);
    expect(form.get('code_verifier')).toBe(request.verifier);
    expect(form.get('grant_type')).toBe('authorization_code');
  });
});

describe('keeping a sign in fresh', () => {
  it('keeps the refresh token it holds when the server sends no new one', async () => {
    const { fetch } = web({
      [KEPT.tokenEndpoint]: () => json({ access_token: 'second', expires_in: 60 }),
    });

    const renewed = await renewSignIn(KEPT, fetch, NOW);

    expect(renewed).toMatchObject({ accessToken: 'second', refreshToken: 'renew-1' });
  });

  it('sends the kept token without asking anybody while it still stands', async () => {
    const signIns = new RemoteSignIns(
      memory(),
      await mkdtemp(join(tmpdir(), 'memnox-signins-')),
    );
    await signIns.set(KEPT);
    const { fetch, asked } = web({});

    expect(await new KeptSignIn(signIns, SERVER, fetch, () => NOW).token()).toBe('first');
    expect(asked).toEqual([]);
  });

  it('renews before a token runs out, and keeps what it got', async () => {
    const signIns = new RemoteSignIns(
      memory(),
      await mkdtemp(join(tmpdir(), 'memnox-signins-')),
    );
    await signIns.set({ ...KEPT, expiresAt: '2026-11-16T10:00:30.000Z' });
    const { fetch } = web({
      [KEPT.tokenEndpoint]: () =>
        json({ access_token: 'second', refresh_token: 'renew-2' }),
    });

    expect(await new KeptSignIn(signIns, SERVER, fetch, () => NOW).token()).toBe(
      'second',
    );
    expect((await signIns.get(SERVER))?.refreshToken).toBe('renew-2');
  });

  it('takes the token another proxy already renewed, rather than renewing twice', async () => {
    const signIns = new RemoteSignIns(
      memory(),
      await mkdtemp(join(tmpdir(), 'memnox-signins-')),
    );
    await signIns.set({ ...KEPT, accessToken: 'second' });
    const { fetch, asked } = web({});

    const token = await new KeptSignIn(signIns, SERVER, fetch, () => NOW).renew('first');

    expect(token).toBe('second');
    expect(asked).toEqual([]);
  });

  it('answers nothing where the sign in cannot be renewed, and leaves what is kept alone', async () => {
    const signIns = new RemoteSignIns(
      memory(),
      await mkdtemp(join(tmpdir(), 'memnox-signins-')),
    );
    await signIns.set(KEPT);
    const { fetch } = web({ [KEPT.tokenEndpoint]: () => json({}, 400) });

    expect(
      await new KeptSignIn(signIns, SERVER, fetch, () => NOW).renew('first'),
    ).toBeUndefined();
    expect(await signIns.get(SERVER)).toEqual(KEPT);
  });

  it('has no sign in for a server nobody signed in to', async () => {
    const signIns = new RemoteSignIns(
      memory(),
      await mkdtemp(join(tmpdir(), 'memnox-signins-')),
    );
    expect(
      await new KeptSignIn(signIns, SERVER, fetch, () => NOW).token(),
    ).toBeUndefined();
  });
});
