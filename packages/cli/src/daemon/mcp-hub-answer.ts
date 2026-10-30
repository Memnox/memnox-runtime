import {
  DISCOVERED_AGENT_KIND,
  HUB_TRANSPORT,
  hubServerProblems,
  isKeptSecretName,
  MCP_HUB_METHOD,
  minutesToMs,
  nodeSecretStore,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  readHubHealth,
  withAssignment,
  withoutServer,
  writeHubHealth,
  type DaemonRequest,
  type DaemonResponse,
  type DiscoveredAgentKind,
  type HubChange,
  type HubServer,
  type McpSyncSummary,
  type SecretStore,
} from '@memnox/core';
import { importServer, type HubChanged } from '../mcp/hub-changes';
import { testHubServer, type ListerFor } from '../mcp/hub-test';
import { readHubView } from '../mcp/hub-view';
import { syncHub, type HubSynced } from '../mcp/hub-writer';

/**
 * The MCP Hub's methods. Widening is proposed and holds once the person signs it on the card;
 * narrowing is done at once. A secret's value goes in from this Mac only and never comes back out.
 */

const MCP_HUB_METHODS: readonly string[] = Object.values(MCP_HUB_METHOD);
const AGENT_KINDS: readonly string[] = Object.values(DISCOVERED_AGENT_KIND);
const TRANSPORTS: readonly string[] = Object.values(HUB_TRANSPORT);

/** Who proposed it, as the card names it: the hub, on the person's own request from a screen. */
const PROPOSED_BY = 'agt_memnox-hub';
const PROPOSAL_TTL_MS = minutesToMs(5);

/** A value typed on a phone would cross the relay, so it is refused there and typed at the Mac. */
const SECRET_FROM_AFAR = 'A secret is typed on this computer, never sent from a phone.';

export function isMcpHubMethod(method: string): boolean {
  return MCP_HUB_METHODS.includes(method);
}

interface McpHubDeps {
  now: Date;
  /** A paired phone, which may read and propose but never hand over a secret's value. */
  remote: boolean;
  secrets?: SecretStore;
  listerFor?: ListerFor;
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function mcpHubAnswer(
  home: string,
  request: DaemonRequest,
  deps: McpHubDeps,
): Promise<DaemonResponse> {
  const secrets = deps.secrets ?? nodeSecretStore(home);
  const answered = await answerOf(home, request, { ...deps, secrets }).catch(
    (err: unknown): Answered => refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  const mcpHub = await readHubView(home, { secrets, now: deps.now });
  return { id: request.id, ...answered, mcpHub };
}

type Resolved = McpHubDeps & { secrets: SecretStore };

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: Resolved,
): Promise<Answered> {
  switch (request.method) {
    case MCP_HUB_METHOD.SERVER_PUT:
      return putServer(home, request, deps.now);
    case MCP_HUB_METHOD.SERVER_REMOVE:
      return removeServer(home, request);
    case MCP_HUB_METHOD.ASSIGN:
      return assign(home, request, deps.now);
    case MCP_HUB_METHOD.IMPORT:
      return importOne(home, request);
    case MCP_HUB_METHOD.SYNC:
      return syncedAnswer(await syncHub(home, await readHub(home)));
    case MCP_HUB_METHOD.TEST:
      return test(home, request, deps);
    case MCP_HUB_METHOD.SECRET_SET:
      return setSecret(request, deps);
    case MCP_HUB_METHOD.SECRET_REMOVE:
      return removeSecret(request, deps.secrets);
    default:
      return { ok: true };
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

/** A server added or replaced is wider reach for every agent it is given to, so it waits on a signature. */
async function putServer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const server = hubServerFrom(request.mcpServer);
  if (server === null)
    return refused('Send the server as a name, a transport, env and secrets.');
  const problems = hubServerProblems(server);
  if (problems.length > 0) return refused(problems.join(' '));
  return propose(
    home,
    { put: server },
    { rationale: `Add the MCP server ${server.name}`, now },
  );
}

async function removeServer(home: string, request: DaemonRequest): Promise<Answered> {
  const name = request.mcpServerName;
  if (name === undefined) return refused('Name the server to remove.');
  const synced = await syncHub(home, withoutServer(await readHub(home), name));
  const { [name]: _gone, ...health } = await readHubHealth(home);
  await writeHubHealth(home, health);
  return syncedAnswer(synced);
}

/** Giving a server to an agent is signed; taking it away is done at once. */
async function assign(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const server = request.mcpServerName;
  const agent = agentOf(request.mcpAgent);
  if (server === undefined || agent === null)
    return refused('Name the server and the agent.');
  const hub = await readHub(home);
  if (!hub.servers.some((each) => each.name === server))
    return refused(`The hub has no server named ${server}.`);
  if (request.mcpOn === true) {
    const rationale = `Give the MCP server ${server} to ${agent}`;
    return propose(home, { assign: { server, agent } }, { rationale, now });
  }
  return syncedAnswer(await syncHub(home, withAssignment(hub, { server, agent }, false)));
}

async function propose(
  home: string,
  change: HubChange,
  { rationale, now }: { rationale: string; now: Date },
): Promise<Answered> {
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.MCP_HUB, hub: change },
    rationale,
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { ok: true, proposed: proposal.id };
}

async function importOne(home: string, request: DaemonRequest): Promise<Answered> {
  const name = request.mcpServerName;
  const agent = agentOf(request.mcpAgent);
  if (name === undefined || agent === null)
    return refused('Name the server and the agent it was found in.');
  return changedAnswer(await importServer(home, { name, agent }));
}

async function test(
  home: string,
  request: DaemonRequest,
  deps: Resolved,
): Promise<Answered> {
  const hub = await readHub(home);
  const server = hub.servers.find((each) => each.name === request.mcpServerName);
  if (server === undefined) return refused('Name a server the hub holds.');
  const mcpHealth = await testHubServer(home, server, {
    secrets: deps.secrets,
    now: deps.now,
    ...(deps.listerFor === undefined ? {} : { listerFor: deps.listerFor }),
  });
  return { ok: true, mcpHealth };
}

async function setSecret(request: DaemonRequest, deps: Resolved): Promise<Answered> {
  if (deps.remote) return refused(SECRET_FROM_AFAR);
  const name = request.mcpSecret;
  const value = request.mcpSecretValue;
  if (name === undefined || !isKeptSecretName(name))
    return refused('A secret name is letters, digits, dots, dashes or underscores.');
  if (value === undefined || value === '') return refused('Type the secret to keep.');
  await deps.secrets.set(name, value);
  return { ok: true };
}

async function removeSecret(
  request: DaemonRequest,
  secrets: SecretStore,
): Promise<Answered> {
  const name = request.mcpSecret;
  if (name === undefined || !isKeptSecretName(name))
    return refused('Name the secret to remove.');
  await secrets.remove(name);
  return { ok: true };
}

function changedAnswer(changed: HubChanged): Answered {
  return 'refused' in changed ? refused(changed.refused) : syncedAnswer(changed.synced);
}

function syncedAnswer({ plan, files }: HubSynced): Answered {
  const mcpSynced: McpSyncSummary = { added: 0, updated: 0, removed: 0, files };
  for (const file of plan.files) {
    mcpSynced.added += file.add.length;
    mcpSynced.updated += file.update.length;
    mcpSynced.removed += file.remove.length;
  }
  return { ok: true, mcpSynced };
}

function agentOf(value: string | undefined): DiscoveredAgentKind | null {
  // Cast is safe: checked against every kind just before.
  return value !== undefined && AGENT_KINDS.includes(value)
    ? (value as DiscoveredAgentKind)
    : null;
}

/** The server as a screen sent it, which is untrusted JSON until every field is checked. */
function hubServerFrom(value: unknown): HubServer | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { name, transport, description, command, args, url } = raw;
  if (typeof name !== 'string' || typeof transport !== 'string') return null;
  if (!TRANSPORTS.includes(transport)) return null;
  const env = stringRecord(raw['env']);
  const secrets = stringRecord(raw['secrets']);
  if (env === null || secrets === null) return null;
  if (args !== undefined && !isStringList(args)) return null;
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
  };
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
