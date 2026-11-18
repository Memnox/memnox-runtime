import { canonicalJson } from '../domain/canonical-json';
import { digest } from '../domain/digest';
import {
  DISCOVERED_AGENT_KIND,
  type DiscoveredAgentKind,
} from '../discovery/discovery.constants';
import { SESSION_SERVER_NAME, WORKSPACE_SERVER_NAME } from '../discovery/own-tools';
import {
  AGENT_FLAG,
  isOwnServer,
  PROXY_BINARY,
  WRAP_MARKER,
  type ServerLaunch,
} from '../discovery/wrap';
import { CONFIG_FORMAT, type ConfigFormat } from '../discovery/wrap-text';
import {
  HUB_TRANSPORT,
  serversFor,
  type Hub,
  type HubServer,
  type HubWritten,
} from './registry';
import { secretRef } from './secret-ref';

/**
 * What one sync would change in each agent's config. Pure: the caller reads the files,
 * hands their servers in, and writes what comes back, so a test needs no disk.
 */

/** Marks a line the hub wrote, beside the wrap marker the proxy already ignores. */
export const HUB_MARKER = '--memnox-hub';

/** The proxy's flags for a remote server: its address, and each header as `Name: value`. */
export const URL_FLAG = '--url';
export const HEADER_FLAG = '--header';

/** How an agent's JSON config names a server it reaches over HTTP itself. */
export const URL_ENTRY_TYPE = 'http';

/** A remote server as a JSON config declares it, which the agent reaches and signs in to itself. */
export interface UrlEntry {
  type: typeof URL_ENTRY_TYPE;
  url: string;
  headers?: Record<string, string>;
}

/** Agents that start a command and skip a line naming an address, so none is written for them. */
const COMMAND_ONLY_AGENTS: readonly DiscoveredAgentKind[] = [
  DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP,
];

/** Said where a server the agent must sign in to cannot be written as an address. */
export const NO_ADDRESS_LINE =
  'It signs you in through the agent, and this agent cannot be given a server by its address, so add it in the agent itself.';

export type HubEntry = ServerLaunch | UrlEntry;

/** One config as the caller read it: the agent it belongs to and what it declares now. */
export interface ConfigServers {
  path: string;
  format: ConfigFormat;
  agent?: DiscoveredAgentKind;
  /** A repository's own file is read for what it holds and never written. */
  shared?: true;
  servers: Readonly<Record<string, unknown>>;
}

export const DRIFT = {
  /** The person changed a line the hub wrote, so the hub leaves it and says so. */
  EDITED: 'edited',
  /** The person removed a line the hub wrote, so the hub does not put it back on its own. */
  REMOVED: 'removed',
} as const;

export type DriftKind = (typeof DRIFT)[keyof typeof DRIFT];

export interface FilePlan {
  path: string;
  format: ConfigFormat;
  agent?: DiscoveredAgentKind;
  add: { name: string; entry: HubEntry }[];
  update: { name: string; entry: HubEntry }[];
  remove: string[];
  /** Servers the person configured themselves, offered for import and never touched. */
  found: string[];
  drifted: { name: string; kind: DriftKind }[];
  /** Wanted here but not writable, with the reason the screen shows. */
  skipped: { name: string; reason: string }[];
}

export interface SyncPlan {
  files: FilePlan[];
}

/**
 * The line one agent gets for one server: a command behind the proxy, which also reaches a remote
 * server, so its calls are ruled on and recorded. Only a server the agent must sign in to is its address.
 */
export function entryFor(server: HubServer, agent: DiscoveredAgentKind): HubEntry {
  if (isDirect(server)) return directEntry(server);
  if (server.transport === HUB_TRANSPORT.HTTP) return remoteEntry(server, agent);
  const env: Record<string, string> = { ...server.env };
  for (const [variable, secret] of Object.entries(server.secrets))
    env[variable] = secretRef(secret);
  return {
    command: PROXY_BINARY,
    args: [
      WRAP_MARKER,
      HUB_MARKER,
      '--name',
      server.name,
      AGENT_FLAG,
      agent,
      '--',
      server.command ?? '',
      ...(server.args ?? []),
    ],
    ...(Object.keys(env).length === 0 ? {} : { env }),
  };
}

/** Whether the agent reaches this server itself, because the sign in it asks for is the agent's to do. */
export function isDirect(server: HubServer): boolean {
  return server.transport === HUB_TRANSPORT.HTTP && server.direct === true;
}

/** The address line an agent's own config holds, as the agent would have written it. */
export function directEntry(server: Pick<HubServer, 'url' | 'headers'>): UrlEntry {
  const headers = server.headers ?? {};
  return {
    type: URL_ENTRY_TYPE,
    url: server.url ?? '',
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
}

/** Whether a config can hold a server by its address: a JSON one, for an agent that reads such a line. */
export function takesAddressLine(
  format: ConfigFormat,
  agent: DiscoveredAgentKind,
): boolean {
  return format === CONFIG_FORMAT.JSON && !COMMAND_ONLY_AGENTS.includes(agent);
}

function remoteEntry(server: HubServer, agent: DiscoveredAgentKind): ServerLaunch {
  const headers = Object.entries(server.headers ?? {}).flatMap(([name, value]) => [
    HEADER_FLAG,
    `${name}: ${value}`,
  ]);
  return {
    command: PROXY_BINARY,
    args: [
      WRAP_MARKER,
      HUB_MARKER,
      '--name',
      server.name,
      AGENT_FLAG,
      agent,
      URL_FLAG,
      server.url ?? '',
      ...headers,
    ],
  };
}

/** The address and headers of a line that reaches a remote server through the proxy, or null for any other. */
export function proxiedRemoteOf(
  launch: Pick<ServerLaunch, 'command' | 'args'>,
): { url: string; headers: Record<string, string> } | null {
  if (launch.command !== PROXY_BINARY) return null;
  const at = launch.args.indexOf(URL_FLAG);
  const url = launch.args[at + 1];
  if (at === -1 || url === undefined) return null;
  const headers: Record<string, string> = {};
  launch.args.forEach((arg, index) => {
    const line = launch.args[index + 1];
    if (arg !== HEADER_FLAG || line === undefined) return;
    const split = line.indexOf(':');
    if (split > 0) headers[line.slice(0, split)] = line.slice(split + 1).trim();
  });
  return { url, headers };
}

/**
 * What is compared to tell an untouched line from an edited one. A text config is read back
 * as its launch line only, so its environment is left out there rather than read as an edit.
 */
export function entryDigest(entry: unknown, format: ConfigFormat): string {
  if (format === CONFIG_FORMAT.JSON || typeof entry !== 'object' || entry === null) {
    return digest(canonicalJson(entry));
  }
  // Cast is safe: only the two launch fields are read, and a missing one digests as absent.
  const { command, args } = entry as Partial<ServerLaunch>;
  return digest(canonicalJson({ command, args }));
}

export function planSync(hub: Hub, configs: readonly ConfigServers[]): SyncPlan {
  return { files: configs.map((config) => planFile(hub, config)) };
}

function planFile(hub: Hub, config: ConfigServers): FilePlan {
  const plan = emptyPlan(config);
  const writtenHere = new Map<string, HubWritten>(
    hub.written
      .filter((each) => each.path === config.path)
      .map((each) => [each.server, each]),
  );
  // A file several agents read, or one that is the repository's, is only ever reported on.
  if (config.agent === undefined || config.shared === true) {
    plan.found.push(
      ...Object.entries(config.servers)
        .filter(([name, entry]) => !writtenHere.has(name) && !isOwnLine(entry))
        .map(([name]) => name),
    );
    return plan;
  }
  const agent = config.agent;
  const wanted = new Map(serversFor(hub, agent).map((server) => [server.name, server]));
  skipUnwritable(plan, wanted, { format: config.format, agent });
  for (const [name, current] of Object.entries(config.servers)) {
    // Memnox's own lines, which onboarding writes and owns, are neither offered for import nor overwritten.
    if (isMemnoxLine(name, current)) continue;
    const written = writtenHere.get(name);
    planExisting(plan, {
      name,
      current,
      wanted: wanted.get(name),
      written,
      agent,
      format: config.format,
    });
  }
  for (const [name, server] of wanted) {
    if (!(name in config.servers))
      planMissing(plan, { server, agent, written: writtenHere.has(name) });
  }
  return plan;
}

/**
 * A server the agent must sign in to, where this config cannot hold an address: not wanted here
 * after all, so a proxy line the hub wrote earlier is taken back rather than left dead.
 */
function skipUnwritable(
  plan: FilePlan,
  wanted: Map<string, HubServer>,
  config: { format: ConfigFormat; agent: DiscoveredAgentKind },
): void {
  for (const [name, server] of wanted) {
    if (!isDirect(server) || takesAddressLine(config.format, config.agent)) continue;
    wanted.delete(name);
    plan.skipped.push({ name, reason: NO_ADDRESS_LINE });
  }
}

function emptyPlan(config: ConfigServers): FilePlan {
  return {
    path: config.path,
    format: config.format,
    ...(config.agent === undefined ? {} : { agent: config.agent }),
    add: [],
    update: [],
    remove: [],
    found: [],
    drifted: [],
    skipped: [],
  };
}

interface Missing {
  server: HubServer;
  agent: DiscoveredAgentKind;
  written: boolean;
}

/** A wanted server the file does not hold: added, unless the person removed what the hub wrote. */
function planMissing(plan: FilePlan, missing: Missing): void {
  const { server, agent, written } = missing;
  if (written) {
    plan.drifted.push({ name: server.name, kind: DRIFT.REMOVED });
    return;
  }
  plan.add.push({ name: server.name, entry: entryFor(server, agent) });
}

interface Existing {
  name: string;
  current: unknown;
  wanted: HubServer | undefined;
  written: HubWritten | undefined;
  agent: DiscoveredAgentKind;
  format: ConfigFormat;
}

function planExisting(plan: FilePlan, each: Existing): void {
  const { name, current, wanted, written, agent, format } = each;
  if (written === undefined) {
    // Already the very line the hub would write, so it is taken as the hub's own rather than waiting forever.
    if (wanted !== undefined && isHubLine(current, wanted, agent, format)) {
      plan.update.push({ name, entry: entryFor(wanted, agent) });
      return;
    }
    // Somebody's own server: a hub server of the same name would overwrite it, so it waits.
    if (wanted !== undefined)
      plan.skipped.push({
        name,
        reason: 'You already configured a server with this name here.',
      });
    else plan.found.push(name);
    return;
  }
  if (entryDigest(current, format) !== written.digest) {
    plan.drifted.push({ name, kind: DRIFT.EDITED });
    return;
  }
  if (wanted === undefined) {
    plan.remove.push(name);
    return;
  }
  const entry = entryFor(wanted, agent);
  if (entryDigest(entry, format) !== written.digest) plan.update.push({ name, entry });
}

/** Whether a line in an agent's config is exactly what the hub writes for this server and agent. */
export function isHubLine(
  current: unknown,
  server: HubServer,
  agent: DiscoveredAgentKind,
  format: ConfigFormat,
): boolean {
  return entryDigest(current, format) === entryDigest(entryFor(server, agent), format);
}

/** Memnox's own line in an agent's own config: a name onboarding gives it, or a line starting its own server. */
export function isMemnoxLine(name: string, entry: unknown): boolean {
  return (
    name === WORKSPACE_SERVER_NAME || name === SESSION_SERVER_NAME || isOwnLine(entry)
  );
}

/** A line that starts Memnox's own session server or workspace bridge, wherever it is found. */
function isOwnLine(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  // Cast is safe: isOwnServer checks the command and args are there before it reads them.
  return isOwnServer(entry as ServerLaunch);
}

/** The written record after a plan was applied, so the next sync knows what is ours. */
export function writtenAfter(hub: Hub, plan: SyncPlan): HubWritten[] {
  const touched = new Set<string>();
  const next: HubWritten[] = [];
  for (const file of plan.files) {
    for (const each of [...file.add, ...file.update]) {
      touched.add(`${file.path}\u0000${each.name}`);
      next.push({
        path: file.path,
        server: each.name,
        digest: entryDigest(each.entry, file.format),
      });
    }
    for (const name of file.remove) touched.add(`${file.path}\u0000${name}`);
  }
  const kept = hub.written.filter(
    (each) => !touched.has(`${each.path}\u0000${each.server}`),
  );
  return [...kept, ...next];
}
