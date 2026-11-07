import {
  agentsOf,
  HUB_TRANSPORT,
  hubServerProblems,
  isHubLine,
  isMemnoxLine,
  isOrgServer,
  isOwnServer,
  proxiedRemoteOf,
  readHub,
  readOrgServers,
  unwrapLaunch,
  withAssignment,
  withChange,
  withServer,
  type DiscoveredAgentKind,
  type FilePlan,
  type Hub,
  type HubChange,
  type HubServer,
  type ServerLaunch,
} from '@memnox/core';
import { applyFilePlan } from './hub-files';
import { readHubConfigs, syncHub, type HubSynced } from './hub-writer';

/**
 * Changes to the hub that end in a sync: a signed proposal carried out, and a server the person
 * configured taken in for the agent that already had it. Each says why in words when it cannot.
 */

export type HubChanged = { synced: HubSynced } | { refused: string };

/** A signed proposal carried out, checked again since a proposal file can be written by hand. */
export async function applyHubChange(
  home: string,
  change: HubChange,
): Promise<HubChanged> {
  const hub = await readHub(home);
  if ('put' in change) {
    const problems = hubServerProblems(change.put);
    if (problems.length > 0) return { refused: problems.join(' ') };
    if (isOrgServer(await readOrgServers(home), change.put.name))
      return { refused: orgOwned(change.put.name) };
  } else if (!hub.servers.some((each) => each.name === change.assign.server)) {
    return { refused: `The hub has no server named ${change.assign.server}.` };
  }
  return { synced: await syncHub(home, withChange(hub, change)) };
}

/** What a screen is told when it reaches for a server only the organization changes. */
export function orgOwned(name: string): string {
  return `${name} is the organization's server, so it is changed in Memnox Cloud rather than here.`;
}

/**
 * The person's own line for this agent, taken into the hub and written back behind the proxy.
 * Nothing widens: the same agent keeps the same server, now governed.
 */
export async function importServer(
  home: string,
  wanted: { name: string; agent: DiscoveredAgentKind },
): Promise<HubChanged> {
  const hub = await readHub(home);
  if (isOrgServer(await readOrgServers(home), wanted.name))
    return {
      refused: `The organization already provides a server named ${wanted.name}.`,
    };
  const configs = await readHubConfigs(home, home);
  const config = configs.find(
    (each) =>
      each.agent === wanted.agent && each.shared !== true && wanted.name in each.servers,
  );
  if (config === undefined)
    return { refused: `${wanted.agent} has no server named ${wanted.name} to import.` };
  const line = config.servers[wanted.name];
  // Onboarding's own line carries this machine's credential, and the hub never takes it in.
  if (isMemnoxLine(wanted.name, line))
    return {
      refused: `${wanted.name} is Memnox's own server, so it stays as onboarding wrote it.`,
    };
  const held = hub.servers.find((each) => each.name === wanted.name);
  if (held !== undefined) return adopted(home, hub, { held, line, config, wanted });
  const server = serverOf(wanted.name, line);
  if (server === null)
    return { refused: `${wanted.name} is not a server line Memnox can read.` };
  const problems = hubServerProblems(server);
  if (problems.length > 0) return { refused: problems.join(' ') };
  await applyFilePlan(home, config, removal(config.path, config.format, wanted.name));
  const taken = withAssignment(
    withServer(hub, server),
    { server: server.name, agent: wanted.agent },
    true,
  );
  return { synced: await syncHub(home, taken) };
}

/**
 * A found line for a server the hub already holds: taken in when it is the very line the hub writes for this
 * agent, so nothing widens, and refused in words when it is a different server under the same name.
 */
async function adopted(
  home: string,
  hub: Hub,
  found: {
    held: HubServer;
    line: unknown;
    config: { format: FilePlan['format'] };
    wanted: { name: string; agent: DiscoveredAgentKind };
  },
): Promise<HubChanged> {
  const { held, line, config, wanted } = found;
  if (agentsOf(hub, held.name).includes(wanted.agent))
    return { refused: `The hub already has a server named ${wanted.name}.` };
  if (!isHubLine(line, held, wanted.agent, config.format))
    return {
      refused: `The hub already has a different server named ${wanted.name}, so this one stays as it is. Rename one of them to bring it in.`,
    };
  const taken = withAssignment(hub, { server: held.name, agent: wanted.agent }, true);
  return { synced: await syncHub(home, taken) };
}

function removal(path: string, format: FilePlan['format'], name: string): FilePlan {
  return {
    path,
    format,
    add: [],
    update: [],
    remove: [name],
    found: [],
    drifted: [],
    skipped: [],
  };
}

/** A config's line as a hub server: a URL, or a launch line with any earlier wrap taken off. */
function serverOf(name: string, entry: unknown): HubServer | null {
  if (typeof entry !== 'object' || entry === null) return null;
  // Cast is safe: each field is checked for its type below before it is used.
  const line = entry as Record<string, unknown>;
  if (typeof line['url'] === 'string')
    return remoteServer(name, line['url'], stringsOf(line['headers']));
  if (typeof line['command'] !== 'string') return null;
  const args = Array.isArray(line['args'])
    ? line['args'].filter((arg): arg is string => typeof arg === 'string')
    : [];
  const launch: ServerLaunch = {
    command: line['command'],
    args,
    env: stringsOf(line['env']),
  };
  // Memnox's own session server answers from the ledger, so putting it behind the proxy would govern itself.
  if (isOwnServer(launch)) return null;
  const remote = proxiedRemoteOf(launch);
  if (remote !== null) return remoteServer(name, remote.url, remote.headers);
  const original = unwrapLaunch(launch) ?? launch;
  return {
    name,
    transport: HUB_TRANSPORT.STDIO,
    command: original.command,
    args: original.args,
    env: original.env ?? {},
    secrets: {},
  };
}

/** A remote server as the hub keeps it, from a URL line or one the proxy already reaches it through. */
function remoteServer(
  name: string,
  url: string,
  headers: Record<string, string>,
): HubServer {
  return {
    name,
    transport: HUB_TRANSPORT.HTTP,
    url,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    env: {},
    secrets: {},
  };
}

function stringsOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string',
    ),
  );
}
