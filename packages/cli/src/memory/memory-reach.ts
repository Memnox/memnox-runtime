import {
  nodeSecretStore,
  readHub,
  resolveSecretRefs,
  secretRef,
  type McpMemoryCall,
  type SecretStore,
  type SourceReach,
} from '@memnox/core';
import { McpPool } from '../local-tools/mcp-client';

/**
 * What a memory source reaches outside this process: the OS store for a key, the network for an
 * API the person added, and a hub server started the way the hub starts it. Nothing else.
 */

/** One pool for the daemon's life, so a memory server read twice is started once. */
const pool = new McpPool();

export function memoryReach(
  home: string,
  secrets: SecretStore = nodeSecretStore(home),
): SourceReach {
  return {
    secret: (name) => secrets.get(name),
    fetch: globalThis.fetch,
    mcp: (server, tool) => hubCall(home, secrets, { server, tool }),
  };
}

/** The hub server's tool, called with no arguments; refused where the server is gone or remote. */
function hubCall(
  home: string,
  secrets: SecretStore,
  { server, tool }: { server: string; tool: string },
): McpMemoryCall {
  return async () => {
    const hub = await readHub(home);
    const found = hub.servers.find((each) => each.name === server);
    if (found === undefined) throw new Error(`${server} is not in the MCP Hub.`);
    if (found.command === undefined)
      throw new Error(`${server} is a remote server, which memory does not read yet.`);
    const refs: Record<string, string> = { ...found.env };
    for (const [variable, secret] of Object.entries(found.secrets))
      refs[variable] = secretRef(secret);
    const { env, missing } = await resolveSecretRefs(refs, (name) => secrets.get(name));
    if (missing.length > 0)
      throw new Error(`Not held yet: ${missing.map((each) => each.secret).join(', ')}.`);
    const launch = { command: found.command, args: found.args ?? [], env };
    return pool.session(server, launch).call(tool, {});
  };
}
