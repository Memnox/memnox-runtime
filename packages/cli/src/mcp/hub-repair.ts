import {
  agentShown,
  carriesCredential,
  directEntry,
  hubServerProblems,
  HUB_TRANSPORT,
  isDirect,
  isOrgServer,
  nodeSecretStore,
  proxiedRemoteOf,
  readHub,
  readOrgServers,
  secretNamesIn,
  SERVER_TROUBLE,
  ServerTroubles,
  takesAddressLine,
  troubleOfStatus,
  withServer,
  writeHub,
  type DiscoveredAgentKind,
  type FilePlan,
  type Hub,
  type HubServer,
  type SecretStore,
  type ServerLaunch,
} from '@memnox/core';
import { applyFilePlan, type HubConfig } from './hub-files';
import { readHubConfigs, syncHub } from './hub-writer';
import { headersToSend } from './remote-headers';
import { remoteToolsOf } from './remote-tools';

/**
 * Finding the remote servers that cannot connect behind the proxy and handing back the ones that
 * ask for a sign in, since only the agent can do that. Read off each agent's own config as well as
 * the hub, so a line whose hub record is gone is still found and still put right.
 */

export const REMOTE_VERDICT = {
  /** It answered through the proxy, so it stays where it is. */
  WORKING: 'working',
  /** It asks for a sign in only the agent can do, so it is handed back. */
  SIGN_IN: 'sign-in',
  /** It refused the credential Memnox sends, which is the person's to replace, not a sign in to hand back. */
  CREDENTIAL: 'credential',
  /** It did not answer at all, which handing back would not fix. */
  UNREACHABLE: 'unreachable',
} as const;

export type RemoteVerdict = (typeof REMOTE_VERDICT)[keyof typeof REMOTE_VERDICT];

/** One remote server behind the proxy, where it was found and what asking it came to. */
export interface CheckedRemote {
  name: string;
  url: string;
  verdict: RemoteVerdict;
  /** The agents whose own config reaches it through the proxy. */
  agents: DiscoveredAgentKind[];
  /** Set where nothing here may change it, with the sentence that says why. */
  locked?: string;
}

export interface RepairDeps {
  secrets?: SecretStore;
  /** How a remote server is reached; injected so a test needs no network. */
  fetch?: typeof fetch;
}

/** A line in one agent's own config that reaches a remote server through the proxy. */
interface ProxiedLine {
  config: HubConfig;
  agent: DiscoveredAgentKind;
  name: string;
  url: string;
  headers: Record<string, string>;
}

/** What asking a remote server comes to, asked exactly the way the proxy would reach it. */
export async function remoteVerdict(
  home: string,
  server: Pick<HubServer, 'name' | 'url' | 'headers'>,
  deps: RepairDeps = {},
): Promise<RemoteVerdict> {
  const secrets = deps.secrets ?? nodeSecretStore(home);
  const sent = server.headers ?? {};
  const { headers, missing } = await headersToSend(server, {
    home,
    secrets,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  // A secret not held is said by the proxy itself, and is nothing a sign in would settle.
  if (missing.length > 0) return REMOTE_VERDICT.CREDENTIAL;
  const listed = await remoteToolsOf({
    name: server.name,
    url: server.url ?? '',
    headers,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  if (!('error' in listed)) return REMOTE_VERDICT.WORKING;
  const trouble = troubleOfStatus(listed.status, carriesCredential(sent));
  if (trouble === SERVER_TROUBLE.SIGN_IN) return REMOTE_VERDICT.SIGN_IN;
  return trouble === SERVER_TROUBLE.CREDENTIAL
    ? REMOTE_VERDICT.CREDENTIAL
    : REMOTE_VERDICT.UNREACHABLE;
}

/** Every remote server behind the proxy on this machine, each asked once. */
export async function checkRemotes(
  home: string,
  deps: RepairDeps = {},
): Promise<CheckedRemote[]> {
  const [hub, org, lines] = await Promise.all([
    readHub(home),
    readOrgServers(home),
    proxiedLines(home),
  ]);
  const remotes = new Map<string, Pick<HubServer, 'name' | 'url' | 'headers'>>();
  for (const line of lines)
    remotes.set(line.name, { name: line.name, url: line.url, headers: line.headers });
  // A server the hub gives in one repository only has no line in an agent's own config.
  for (const server of hub.servers) {
    if (server.transport === HUB_TRANSPORT.HTTP && !isDirect(server))
      remotes.set(server.name, server);
  }
  return Promise.all(
    [...remotes.values()].map(async (remote) => ({
      name: remote.name,
      url: remote.url ?? '',
      verdict: await remoteVerdict(home, remote, deps),
      agents: lines.filter((line) => line.name === remote.name).map((line) => line.agent),
      ...(isOrgServer(org, remote.name) ? { locked: ORG_OWNED } : {}),
    })),
  );
}

const ORG_OWNED =
  "It is the organization's server, so it is changed in Memnox Cloud rather than here.";

async function proxiedLines(home: string): Promise<ProxiedLine[]> {
  const found: ProxiedLine[] = [];
  for (const config of await readHubConfigs(home, home)) {
    const agent = config.agent;
    if (agent === undefined || config.shared === true) continue;
    for (const [name, entry] of Object.entries(config.servers)) {
      const launch = launchOf(entry);
      const remote = launch === null ? null : proxiedRemoteOf(launch);
      if (remote !== null) found.push({ config, agent, name, ...remote });
    }
  }
  return found;
}

/**
 * Every remote server behind the proxy put back as its own address, for `unwrap` and `uninstall`,
 * since a line left pointing at a proxy that is gone is a tool disconnected for good.
 */
export async function restoreProxiedRemotes(home: string): Promise<HandedBack> {
  const result: HandedBack = { handed: [], left: [], files: [] };
  const lines = await proxiedLines(home);
  const agents = new Map<string, DiscoveredAgentKind[]>();
  await rewriteLeftover(home, {
    wanted: [...new Set(lines.map((line) => line.name))],
    agents,
    result,
  });
  for (const [name, given] of agents) result.handed.push({ name, agents: given });
  return result;
}

/** A remote server by its name, wherever it is declared: the hub, a proxy line, or an agent's own address line. */
export async function findRemote(
  home: string,
  name: string,
): Promise<{ name: string; url: string; headers: Record<string, string> } | null> {
  const held = (await readHub(home)).servers.find((each) => each.name === name);
  if (held?.transport === HUB_TRANSPORT.HTTP && held.url !== undefined)
    return { name, url: held.url, headers: held.headers ?? {} };
  const line = (await proxiedLines(home)).find((each) => each.name === name);
  if (line !== undefined) return { name, url: line.url, headers: line.headers };
  for (const config of await readHubConfigs(home, home)) {
    const entry: unknown = config.servers[name];
    if (typeof entry !== 'object' || entry === null) continue;
    const url = (entry as { url?: unknown }).url;
    if (typeof url === 'string') return { name, url, headers: {} };
  }
  return null;
}

function launchOf(entry: unknown): ServerLaunch | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { command, args } = entry as { command?: unknown; args?: unknown };
  if (typeof command !== 'string' || !Array.isArray(args)) return null;
  // Cast is safe: the two fields a proxied line is read by were checked just above.
  return entry as ServerLaunch;
}

interface HandedBack {
  /** Each server handed back, with the agents whose config now names its address. */
  handed: { name: string; agents: DiscoveredAgentKind[] }[];
  /** Each one that could not be, with the sentence that says why. */
  left: { name: string; reason: string }[];
  /** The configs written, each backed up first. */
  files: string[];
}

/**
 * Hands each named server back to its agents: the hub keeps it, marked as reached by the agent itself,
 * and any proxy line the hub no longer answers for is rewritten where it stands.
 */
export async function handBack(
  home: string,
  names: readonly string[],
): Promise<HandedBack> {
  const result: HandedBack = { handed: [], left: [], files: [] };
  let hub = await readHub(home);
  for (const name of names) {
    const held = hub.servers.find((each) => each.name === name);
    if (held === undefined || held.transport !== HUB_TRANSPORT.HTTP) continue;
    const direct: HubServer = { ...held, direct: true };
    const problems = hubServerProblems(direct);
    if (problems.length > 0) result.left.push({ name, reason: problems.join(' ') });
    else hub = withServer(hub, direct);
  }
  const refused = new Set(result.left.map((each) => each.name));
  const wanted = names.filter((name) => !refused.has(name));
  const synced = await syncHub(home, hub);
  result.files.push(...synced.files);
  const agents = agentsWritten(synced.plan.files, wanted);
  for (const skipped of synced.plan.files.flatMap((file) => file.skipped)) {
    if (wanted.includes(skipped.name)) result.left.push(skipped);
  }
  await rewriteLeftover(home, { wanted, agents, result });
  const troubles = new ServerTroubles(home);
  for (const name of wanted) {
    const given = agents.get(name) ?? [];
    if (given.length === 0) continue;
    result.handed.push({ name, agents: given });
    await troubles.clearServer(name);
  }
  return result;
}

function agentsWritten(
  files: readonly FilePlan[],
  wanted: readonly string[],
): Map<string, DiscoveredAgentKind[]> {
  const agents = new Map<string, DiscoveredAgentKind[]>();
  for (const file of files) {
    if (file.agent === undefined) continue;
    for (const each of [...file.add, ...file.update]) {
      if (!wanted.includes(each.name)) continue;
      agents.set(each.name, [...(agents.get(each.name) ?? []), file.agent]);
    }
  }
  return agents;
}

interface Leftover {
  wanted: readonly string[];
  agents: Map<string, DiscoveredAgentKind[]>;
  result: HandedBack;
}

/** Proxy lines the sync did not answer for, such as one whose hub record is gone, rewritten as the address. */
async function rewriteLeftover(home: string, leftover: Leftover): Promise<void> {
  const { wanted, agents, result } = leftover;
  const lines = (await proxiedLines(home)).filter((line) => wanted.includes(line.name));
  const paths = new Set(lines.map((line) => line.config.path));
  const rewritten: ProxiedLine[] = [];
  for (const path of paths) {
    const here = lines.filter((line) => line.config.path === path);
    const [first] = here;
    if (first === undefined) continue;
    const writable = here.filter((line) => canHandBack(line, result));
    if (writable.length === 0) continue;
    await applyFilePlan(home, first.config, rewriteOf(first.config, writable));
    result.files.push(path);
    rewritten.push(...writable);
    for (const line of writable)
      agents.set(line.name, [...(agents.get(line.name) ?? []), line.agent]);
  }
  await forgetWritten(home, rewritten);
}

function canHandBack(line: ProxiedLine, result: HandedBack): boolean {
  // An address line cannot name a kept secret, so such a server stays where its credential can be read.
  if (Object.values(line.headers).some((value) => secretNamesIn(value).length > 0)) {
    result.left.push({
      name: line.name,
      reason: `It carries a secret only Memnox can read, so its line is left as it is.`,
    });
    return false;
  }
  if (takesAddressLine(line.config.format, line.agent)) return true;
  result.left.push({
    name: line.name,
    reason: `${agentShown(line.agent)} cannot be given a server by its address, so its line is left as it is. Add the server in ${agentShown(line.agent)} itself.`,
  });
  return false;
}

function rewriteOf(config: HubConfig, lines: readonly ProxiedLine[]): FilePlan {
  return {
    path: config.path,
    format: config.format,
    add: [],
    update: lines.map((line) => ({ name: line.name, entry: directEntry(line) })),
    remove: [],
    found: [],
    drifted: [],
    skipped: [],
  };
}

/** A line rewritten here is the person's own again, so the hub stops reading it as one it wrote and they edited. */
async function forgetWritten(home: string, lines: readonly ProxiedLine[]): Promise<void> {
  if (lines.length === 0) return;
  const hub: Hub = await readHub(home);
  const rewritten = new Set(lines.map((line) => `${line.config.path}\u0000${line.name}`));
  const written = hub.written.filter(
    (each) => !rewritten.has(`${each.path}\u0000${each.server}`),
  );
  if (written.length !== hub.written.length) await writeHub(home, { ...hub, written });
}
