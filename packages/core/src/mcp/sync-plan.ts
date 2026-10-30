import { canonicalJson } from '../domain/canonical-json';
import { digest } from '../domain/digest';
import type { DiscoveredAgentKind } from '../discovery/discovery.constants';
import {
  AGENT_FLAG,
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

/** A remote server as a JSON config declares it. */
export interface UrlEntry {
  url: string;
}

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
 * The line one agent gets for one server, always a command behind the proxy: a remote server is
 * reached by the proxy, so every agent that starts a command has its calls ruled on and recorded.
 */
export function entryFor(server: HubServer, agent: DiscoveredAgentKind): HubEntry {
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
      ...Object.keys(config.servers).filter((name) => !writtenHere.has(name)),
    );
    return plan;
  }
  const agent = config.agent;
  const wanted = new Map(serversFor(hub, agent).map((server) => [server.name, server]));
  for (const [name, current] of Object.entries(config.servers)) {
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
