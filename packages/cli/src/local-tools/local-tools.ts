import type { ToolConnection } from '@memnox/core';
import type {
  PersonalAnswer,
  PersonalRun,
  PersonalTool,
  PersonalTools,
} from '../sync/personal-work';
import { findLocalTools, localClis, localServers } from './local-catalogue';
import { McpPool } from './mcp-client';
import { daemonGate, runLocalTool } from './local-run';

/**
 * The tools this Mac reaches itself, for whichever process asks: the voice's operator finding and
 * reading, and the daemon running what the person confirmed. One pool per process, so a server one
 * question started answers the next.
 */

const pool = new McpPool();

function findLocal(
  home: string,
  what: string,
  toolkit?: string,
): Promise<PersonalTool[]> {
  return findLocalTools(
    { servers: () => localServers(home), clis: () => localClis(home), pool },
    what,
    toolkit,
  );
}

export function runLocal(
  home: string,
  slug: string,
  argumentsText: string,
  confirmed: boolean,
): Promise<PersonalAnswer<PersonalRun>> {
  return runLocalTool(
    {
      servers: () => localServers(home),
      clis: () => localClis(home),
      pool,
      gate: daemonGate(home),
    },
    slug,
    argumentsText,
    confirmed,
  );
}

/** Every server and signed in tool on this Mac, as connected, for the lists the person sees. */
export async function localConnections(home: string): Promise<ToolConnection[]> {
  const [servers, clis] = await Promise.all([
    localServers(home).catch(() => []),
    localClis(home).catch(() => []),
  ]);
  const names = [
    ...new Set([...servers.map((each) => each.name), ...clis.map((each) => each.name)]),
  ];
  return names.sort().map((toolkit) => ({ toolkit, connected: true, local: true }));
}

const NOTHING_TO_SIGN_IN: Omit<PersonalTools, 'tools'> = {
  accounts: [],
  signInFirst: [],
  signInAgain: [],
  needsAdmin: [],
  unknown: [],
};

/**
 * The person's tools on this Mac first, then those connected through Memnox Cloud. A tool they named
 * that this Mac already reaches is used as it is, so no catalogue sign in is offered for it, and a
 * cloud that cannot be reached still leaves everything local standing.
 */
export async function findEveryTool(
  home: string,
  what: string,
  toolkit: string | undefined,
  cloud: (what: string, toolkit?: string) => Promise<PersonalAnswer<PersonalTools>>,
): Promise<PersonalAnswer<PersonalTools>> {
  const local = await findLocal(home, what, toolkit).catch(() => []);
  if (toolkit !== undefined && local.length > 0)
    return { ok: true, value: { tools: local, ...NOTHING_TO_SIGN_IN } };
  const found = await cloud(what, toolkit);
  if (!found.ok)
    return local.length === 0
      ? found
      : { ok: true, value: { tools: local, ...NOTHING_TO_SIGN_IN } };
  return { ok: true, value: { ...found.value, tools: [...local, ...found.value.tools] } };
}
