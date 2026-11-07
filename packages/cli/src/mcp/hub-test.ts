import { spawn, type ChildProcess } from 'node:child_process';
import {
  HUB_TRANSPORT,
  MCP_HEALTH,
  NodeMcpLister,
  readHubHealth,
  resolveHeaderRefs,
  resolveSecretRefs,
  secretRef,
  writeHubHealth,
  type HubServer,
  type McpLister,
  type McpServerHealth,
  type SecretStore,
} from '@memnox/core';
import { remoteToolsOf } from './remote-tools';

/**
 * Asking one hub server for its tools, run when the person asks and never on a timer. Secrets
 * are resolved into the server's own environment only, the way the proxy starts it.
 */

/** Builds the lister for an environment; injected so a test starts no process. */
export type ListerFor = (env: Record<string, string>) => McpLister;

interface HubTestInput {
  secrets: SecretStore;
  now: Date;
  listerFor?: ListerFor;
  /** How a remote server is reached; injected so a test needs no network. */
  fetch?: typeof fetch;
}

function nodeListerFor(env: Record<string, string>): McpLister {
  return new NodeMcpLister({
    spawn: (command: string, args: readonly string[]): ChildProcess =>
      // stderr is discarded: a server's startup noise is not this answer's business.
      spawn(command, [...args], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...env },
      }),
  });
}

/** Tests the server, keeps what it answered for the hub view, and returns it. */
export async function testHubServer(
  home: string,
  server: HubServer,
  input: HubTestInput,
): Promise<McpServerHealth> {
  const health = await healthOf(server, input);
  const all = await readHubHealth(home);
  await writeHubHealth(home, { ...all, [server.name]: health });
  return health;
}

async function healthOf(
  server: HubServer,
  input: HubTestInput,
): Promise<McpServerHealth> {
  const { secrets, now, listerFor = nodeListerFor } = input;
  const checkedAt = now.toISOString();
  if (server.transport === HUB_TRANSPORT.HTTP) return remoteHealth(server, input);
  if (server.command === undefined)
    return { state: MCP_HEALTH.ERROR, checkedAt, error: 'No command starts it.' };
  const refs: Record<string, string> = { ...server.env };
  for (const [variable, secret] of Object.entries(server.secrets))
    refs[variable] = secretRef(secret);
  const { env, missing } = await resolveSecretRefs(refs, (name) => secrets.get(name));
  if (missing.length > 0) {
    const names = missing.map((each) => each.secret).join(', ');
    return { state: MCP_HEALTH.ERROR, checkedAt, error: `Not held yet: ${names}.` };
  }
  const tools = await listerFor(env).listTools(
    server.name,
    server.command,
    server.args ?? [],
  );
  if (tools.length === 0) {
    return {
      state: MCP_HEALTH.ERROR,
      checkedAt,
      error: 'The server did not start or did not list its tools.',
    };
  }
  return {
    state: MCP_HEALTH.HEALTHY,
    checkedAt,
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
    })),
  };
}

/** A remote server asked the way the proxy reaches it, with each header's secret read here and dropped after. */
async function remoteHealth(
  server: HubServer,
  { secrets, now, fetch }: HubTestInput,
): Promise<McpServerHealth> {
  const checkedAt = now.toISOString();
  const { headers, missing } = await resolveHeaderRefs(server.headers ?? {}, (name) =>
    secrets.get(name),
  );
  if (missing.length > 0) {
    const names = missing.map((each) => each.secret).join(', ');
    return { state: MCP_HEALTH.ERROR, checkedAt, error: `Not held yet: ${names}.` };
  }
  const listed = await remoteToolsOf({
    name: server.name,
    url: server.url ?? '',
    headers,
    ...(fetch === undefined ? {} : { fetch }),
  });
  if ('error' in listed)
    return { state: MCP_HEALTH.ERROR, checkedAt, error: listed.error };
  if (listed.tools.length === 0)
    return { state: MCP_HEALTH.ERROR, checkedAt, error: 'It listed no tools.' };
  return { state: MCP_HEALTH.HEALTHY, checkedAt, tools: listed.tools };
}
