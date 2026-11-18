import {
  carriesCredential,
  KeptSignIn,
  RemoteSignIns,
  resolveHeaderRefs,
  type HubServer,
  type ResolvedHeaders,
  type SecretStore,
} from '@memnox/core';

/**
 * The headers a remote server is asked with, exactly as the proxy sends them: each kept secret
 * resolved, and the sign in Memnox holds for it added where no header carries a credential.
 */

const AUTHORIZATION = 'Authorization';
const BEARER = 'Bearer ';

interface RemoteHeaderDeps {
  /** The Memnox home a sign in is sealed under. */
  home: string;
  secrets: SecretStore;
  /** How a sign in is renewed; injected so a test needs no network. */
  fetch?: typeof fetch;
}

export async function headersToSend(
  server: Pick<HubServer, 'url' | 'headers'>,
  deps: RemoteHeaderDeps,
): Promise<ResolvedHeaders> {
  const sent = server.headers ?? {};
  const resolved = await resolveHeaderRefs(sent, (name) => deps.secrets.get(name));
  if (carriesCredential(sent) || server.url === undefined) return resolved;
  const token = await new KeptSignIn(
    new RemoteSignIns(deps.secrets, deps.home),
    server.url,
    deps.fetch,
  ).token();
  if (token === undefined) return resolved;
  return {
    ...resolved,
    headers: { ...resolved.headers, [AUTHORIZATION]: `${BEARER}${token}` },
  };
}
