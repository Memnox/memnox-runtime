import { spawn, type ChildProcess } from 'node:child_process';
import {
  HUB_TRANSPORT,
  MCP_HEALTH,
  NodeMcpLister,
  readHubHealth,
  resolveSecretRefs,
  secretRef,
  writeHubHealth,
  type HubServer,
  type McpLister,
  type McpServerHealth,
  type SecretStore,
} from '@memnox/core';

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
  { secrets, now, listerFor = nodeListerFor }: HubTestInput,
): Promise<McpServerHealth> {
  const checkedAt = now.toISOString();
  if (server.transport === HUB_TRANSPORT.HTTP || server.command === undefined) {
    return {
      state: MCP_HEALTH.UNKNOWN,
      checkedAt,
      error: 'Testing a remote server is not built yet.',
    };
  }
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
