import { createHash, randomBytes } from 'node:crypto';
import { secondsToMs } from '../domain/time';
import { remoteAddressProblem } from './registry';

/**
 * Signing in to a remote MCP server the way the MCP authorization rules lay out: find who signs
 * people in for it, register as a client, send the person to approve, and keep what comes back in
 * the OS store. The proxy then carries the token, so the server stays connected and governed.
 */

type Fetch = typeof fetch;

/** Where a server's sign in happens, read from what the server itself publishes. */
export interface SignInEndpoints {
  authorization: string;
  token: string;
  /** Where a new client registers; absent where the server takes only clients it already knows. */
  registration?: string;
  /** What the token is asked for, so one issued for this server is not good for another. */
  resource: string;
  scopes?: string[];
}

export interface SignInClient {
  clientId: string;
  clientSecret?: string;
}

/** A sign in as it is kept: everything the proxy needs to send the token and to renew it. */
export interface RemoteSignIn {
  url: string;
  tokenEndpoint: string;
  resource: string;
  client: SignInClient;
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops working, where the server said. */
  expiresAt?: string;
}

/** What the person approves in the browser comes back to, with what proves it is the same request. */
export interface SignInRequest {
  redirectUri: string;
  state: string;
  verifier: string;
  challenge: string;
}

const WELL_KNOWN_RESOURCE = '/.well-known/oauth-protected-resource';
const WELL_KNOWN_SERVER = '/.well-known/oauth-authorization-server';
const WELL_KNOWN_OPENID = '/.well-known/openid-configuration';
/** Where a server with no published metadata signs people in, as the first MCP rules had it. */
const LEGACY_PATHS = {
  authorization: '/authorize',
  token: '/token',
  registration: '/register',
};

const UNAUTHORIZED = 401;
/** Every request in a sign in is bounded, so a server that never answers cannot leave a person waiting on nothing. */
const REQUEST_TIMEOUT_MS = secondsToMs(20);
const CHALLENGE_METHOD = 'S256';
const CLIENT_NAME = 'Memnox';
const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;
/** Renewed this long before it runs out, so a call never leaves with a token about to die. */
const RENEW_AHEAD_MS = secondsToMs(60);
const FORM = 'application/x-www-form-urlencoded';
const JSON_TYPE = 'application/json';
/** The opening request every MCP server answers, which is how one is asked whether it wants a sign in. */
const PROBE = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' });

/** JSON from an address the server named, or null when it is missing, unsafe or not an object. */
async function jsonAt(
  url: string,
  fetcher: Fetch,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  if (remoteAddressProblem(url) !== undefined) return null;
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    // Cast is safe: an object was checked for, and each field is checked where it is read.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // An address that does not answer is one more candidate that held nothing.
    return null;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Whether a server answers a bare request by asking for a sign in, and where it says to look. */
export async function signInAsked(
  url: string,
  fetcher: Fetch,
): Promise<{ asked: boolean; metadata?: string }> {
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': JSON_TYPE, accept: `${JSON_TYPE}, text/event-stream` },
      body: PROBE,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== UNAUTHORIZED) return { asked: false };
    const named = /resource_metadata="([^"]+)"/.exec(
      response.headers.get('www-authenticate') ?? '',
    )?.[1];
    return { asked: true, ...(named === undefined ? {} : { metadata: named }) };
  } catch {
    // Not answering is not asking for a sign in.
    return { asked: false };
  }
}

/** The path a well known address carries after it, which is nothing for a server at its root. */
function pathOf(url: URL): string {
  return url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
}

/** Who signs people in for this server and what the token is for, as the server publishes it. */
async function resourceOf(
  url: string,
  named: string | undefined,
  fetcher: Fetch,
): Promise<{ issuer: string; resource: string; scopes?: string[] }> {
  const at = new URL(url);
  const candidates = [
    ...(named === undefined ? [] : [named]),
    `${at.origin}${WELL_KNOWN_RESOURCE}${pathOf(at)}`,
    `${at.origin}${WELL_KNOWN_RESOURCE}`,
  ];
  for (const candidate of candidates) {
    const found = await jsonAt(candidate, fetcher);
    const servers = found?.['authorization_servers'];
    const issuer = Array.isArray(servers) ? text(servers[0]) : undefined;
    if (found === null || issuer === undefined) continue;
    const scopes = found['scopes_supported'];
    return {
      issuer,
      resource: text(found['resource']) ?? url,
      ...(isTextList(scopes) ? { scopes } : {}),
    };
  }
  // Nothing published, so the server signs people in itself, as the first MCP rules had it.
  return { issuer: at.origin, resource: url };
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/** Everything needed to sign in to this server, or null where it publishes nothing usable. */
export async function discoverSignIn(
  url: string,
  fetcher: Fetch,
  named?: string,
): Promise<SignInEndpoints | null> {
  const { issuer, resource, scopes } = await resourceOf(url, named, fetcher);
  if (remoteAddressProblem(issuer) !== undefined) return null;
  const at = new URL(issuer);
  const candidates = [
    `${at.origin}${WELL_KNOWN_SERVER}${pathOf(at)}`,
    `${at.origin}${WELL_KNOWN_OPENID}${pathOf(at)}`,
    `${at.origin}${pathOf(at)}${WELL_KNOWN_OPENID}`,
  ];
  for (const candidate of candidates) {
    const found = await jsonAt(candidate, fetcher);
    const endpoints = found === null ? null : endpointsOf(found, resource, scopes);
    if (endpoints !== null) return endpoints;
  }
  return {
    authorization: `${at.origin}${LEGACY_PATHS.authorization}`,
    token: `${at.origin}${LEGACY_PATHS.token}`,
    registration: `${at.origin}${LEGACY_PATHS.registration}`,
    resource,
    ...(scopes === undefined ? {} : { scopes }),
  };
}

function endpointsOf(
  found: Record<string, unknown>,
  resource: string,
  scopes: string[] | undefined,
): SignInEndpoints | null {
  const authorization = text(found['authorization_endpoint']);
  const token = text(found['token_endpoint']);
  if (authorization === undefined || token === undefined) return null;
  // Addresses a server names are untrusted, so one that is not https is not followed.
  if ([authorization, token].some((each) => remoteAddressProblem(each) !== undefined))
    return null;
  const registration = text(found['registration_endpoint']);
  return {
    authorization,
    token,
    ...(registration === undefined ? {} : { registration }),
    resource,
    ...(scopes === undefined ? {} : { scopes }),
  };
}

/** Registers Memnox as a client that comes back to this machine, or null where the server takes none. */
export async function registerClient(
  endpoints: SignInEndpoints,
  redirectUri: string,
  fetcher: Fetch,
): Promise<SignInClient | null> {
  if (endpoints.registration === undefined) return null;
  const found = await jsonAt(endpoints.registration, fetcher, {
    method: 'POST',
    headers: { 'content-type': JSON_TYPE },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const clientId = text(found?.['client_id']);
  if (clientId === undefined) return null;
  const clientSecret = text(found?.['client_secret']);
  return { clientId, ...(clientSecret === undefined ? {} : { clientSecret }) };
}

function urlSafe(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** One request's state and proof key, made fresh so an approval can only finish the request that began it. */
export function newSignInRequest(redirectUri: string): SignInRequest {
  const verifier = urlSafe(randomBytes(VERIFIER_BYTES));
  return {
    redirectUri,
    state: urlSafe(randomBytes(STATE_BYTES)),
    verifier,
    challenge: urlSafe(createHash('sha256').update(verifier).digest()),
  };
}

/** The page the person approves on. */
export function approvalUrl(
  endpoints: SignInEndpoints,
  client: SignInClient,
  request: SignInRequest,
): string {
  const page = new URL(endpoints.authorization);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: CHALLENGE_METHOD,
    resource: endpoints.resource,
    ...(endpoints.scopes === undefined ? {} : { scope: endpoints.scopes.join(' ') }),
  };
  for (const [name, value] of Object.entries(params)) page.searchParams.set(name, value);
  return page.toString();
}

interface TokenAsk {
  tokenEndpoint: string;
  client: SignInClient;
  resource: string;
  fields: Record<string, string>;
}

/** One request to the token address, answered with the tokens or null where it was turned down. */
async function tokensFrom(
  ask: TokenAsk,
  fetcher: Fetch,
  now: Date,
): Promise<Pick<RemoteSignIn, 'accessToken' | 'refreshToken' | 'expiresAt'> | null> {
  const secret = ask.client.clientSecret;
  const body = new URLSearchParams({
    ...ask.fields,
    client_id: ask.client.clientId,
    resource: ask.resource,
    ...(secret === undefined ? {} : { client_secret: secret }),
  });
  const found = await jsonAt(ask.tokenEndpoint, fetcher, {
    method: 'POST',
    headers: { 'content-type': FORM, accept: JSON_TYPE },
    body: body.toString(),
  });
  const accessToken = text(found?.['access_token']);
  if (accessToken === undefined) return null;
  const refreshToken = text(found?.['refresh_token']);
  const lasts = found?.['expires_in'];
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(typeof lasts === 'number'
      ? { expiresAt: new Date(now.getTime() + secondsToMs(lasts)).toISOString() }
      : {}),
  };
}

interface CodeExchange {
  url: string;
  endpoints: SignInEndpoints;
  client: SignInClient;
  request: SignInRequest;
  code: string;
}

/** The approval turned into a sign in to keep, or null where the server would not give one. */
export async function exchangeCode(
  exchange: CodeExchange,
  fetcher: Fetch,
  now: Date,
): Promise<RemoteSignIn | null> {
  const { url, endpoints, client, request, code } = exchange;
  const tokens = await tokensFrom(
    {
      tokenEndpoint: endpoints.token,
      client,
      resource: endpoints.resource,
      fields: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: request.redirectUri,
        code_verifier: request.verifier,
      },
    },
    fetcher,
    now,
  );
  if (tokens === null) return null;
  return {
    url,
    tokenEndpoint: endpoints.token,
    resource: endpoints.resource,
    client,
    ...tokens,
  };
}

/** Whether the token is about to run out, so it is renewed before a call leaves with it. */
export function signInExpiring(signIn: RemoteSignIn, now: Date): boolean {
  if (signIn.expiresAt === undefined) return false;
  return Date.parse(signIn.expiresAt) - now.getTime() <= RENEW_AHEAD_MS;
}

/** The sign in with fresh tokens, or null where it cannot be renewed and the person signs in again. */
export async function renewSignIn(
  signIn: RemoteSignIn,
  fetcher: Fetch,
  now: Date,
): Promise<RemoteSignIn | null> {
  if (signIn.refreshToken === undefined) return null;
  const tokens = await tokensFrom(
    {
      tokenEndpoint: signIn.tokenEndpoint,
      client: signIn.client,
      resource: signIn.resource,
      fields: { grant_type: 'refresh_token', refresh_token: signIn.refreshToken },
    },
    fetcher,
    now,
  );
  if (tokens === null) return null;
  const { expiresAt: _old, ...kept } = signIn;
  // A server that sends no new refresh token means the one held still stands.
  return { ...kept, ...tokens };
}
