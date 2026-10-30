import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import {
  DISCOVERED_AGENT_KIND,
  type DiscoveredAgentKind,
} from '../discovery/discovery.constants';
import { canonicalJson } from '../domain/canonical-json';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { HUB_TRANSPORT, hubServerProblems, type Hub, type HubServer } from './registry';

/**
 * The organization's MCP servers, pulled with the workspace bundle and read here as a scope nobody
 * on this machine edits or removes. They are handed to agents beside the hub's own, the same way.
 */

/** One server the organization declared; absent agents is every agent. */
export interface OrgMcpServer extends HubServer {
  agents?: DiscoveredAgentKind[];
}

/** Written by the bundle pull and never by hand. */
const ORG_MCP_FILE = 'org-mcp.json';

const AGENT_KINDS: readonly string[] = Object.values(DISCOVERED_AGENT_KIND);
const TRANSPORTS: readonly string[] = Object.values(HUB_TRANSPORT);

export function orgServersPathFor(home: string): string {
  return join(home, MEMNOX_HOME, ORG_MCP_FILE);
}

/** Every server the bundle carried that the hub could write; one it could not is left out rather than half written. */
export function orgServersFrom(value: unknown): OrgMcpServer[] {
  if (!Array.isArray(value)) return [];
  const servers: OrgMcpServer[] = [];
  for (const each of value) {
    const server = orgServerOf(each);
    if (server !== null && hubServerProblems(server).length === 0) servers.push(server);
  }
  return servers;
}

function orgServerOf(value: unknown): OrgMcpServer | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { name, transport, description, command, args, url, agents } = raw;
  if (typeof name !== 'string' || typeof transport !== 'string') return null;
  if (!TRANSPORTS.includes(transport)) return null;
  const env = stringRecord(raw['env']);
  const secrets = stringRecord(raw['secrets']);
  if (env === null || secrets === null) return null;
  if (args !== undefined && !isStringList(args)) return null;
  if (agents !== undefined && !isStringList(agents)) return null;
  return {
    name,
    // Cast is safe: checked against the transports above.
    transport: transport as HubServer['transport'],
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof command === 'string' ? { command } : {}),
    ...(args === undefined ? {} : { args }),
    ...(typeof url === 'string' ? { url } : {}),
    env,
    secrets,
    ...(agents === undefined ? {} : { agents: kindsOf(agents) }),
  };
}

/** Only kinds this machine knows; a name it does not is an agent it cannot write for. */
function kindsOf(agents: readonly string[]): DiscoveredAgentKind[] {
  // Cast is safe: filtered to the known kinds in the same expression.
  return agents.filter((each) => AGENT_KINDS.includes(each)) as DiscoveredAgentKind[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every((pair) => typeof pair[1] === 'string')) return null;
  // Cast is safe: every value was checked to be a string just above.
  return Object.fromEntries(entries) as Record<string, string>;
}

/** The servers last pulled; none before the first pull, or when the file will not read. */
export async function readOrgServers(home: string): Promise<OrgMcpServer[]> {
  return orgServersFrom(await readJsonFile<unknown>(orgServersPathFor(home)));
}

/** Kept for the hub to read; true when they differ from what was kept, so a caller syncs only then. */
export async function writeOrgServers(
  home: string,
  servers: readonly OrgMcpServer[],
): Promise<boolean> {
  const before = await readOrgServers(home);
  if (canonicalJson(before) === canonicalJson(servers)) return false;
  await writeJsonFile(orgServersPathFor(home), servers);
  return true;
}

/**
 * The hub with the organization's servers beside its own, each given to the agents it names. A
 * local server of the same name stays the person's, and the organization's is not written over it.
 */
export function withOrganization(hub: Hub, org: readonly OrgMcpServer[]): Hub {
  const local = new Set(hub.servers.map((server) => server.name));
  const added = org.filter((server) => !local.has(server.name));
  return {
    ...hub,
    servers: [...hub.servers, ...added.map(hubServerOf)],
    assignments: [
      ...hub.assignments,
      ...added.flatMap((server) =>
        (server.agents ?? everyKind()).map((agent) => ({ server: server.name, agent })),
      ),
    ],
  };
}

function everyKind(): DiscoveredAgentKind[] {
  return Object.values(DISCOVERED_AGENT_KIND);
}

/** The server as the hub writes it, without the organization's list of agents. */
function hubServerOf(server: OrgMcpServer): HubServer {
  const { agents: _agents, ...rest } = server;
  return rest;
}

/** Whether the organization holds a server by this name, which nothing on this machine may change. */
export function isOrgServer(org: readonly OrgMcpServer[], name: string): boolean {
  return org.some((server) => server.name === name);
}
