import {
  agentsOf,
  daysToMs,
  EVENT_SURFACE,
  HUB_TRANSPORT,
  LEDGER_SCAN_LIMIT,
  MCP_HEALTH,
  planSync,
  readHub,
  readHubHealth,
  type HubHealth,
  type HubServer,
  type McpHubEntryView,
  type McpHubServerView,
  type McpHubView,
  type MemnoxEvent,
  type SecretStore,
  type SyncPlan,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { readHubConfigs } from './hub-writer';

/**
 * The hub as a screen draws it, read from the hub file, the agents' configs, the last tests and
 * the ledger. Each secret is reported as held or not; its value is never read into the view.
 */

const WEEK_DAYS = 7;
const MCP_OPERATION_PREFIX = 'mcp.';

interface HubViewInput {
  secrets: SecretStore;
  now: Date;
}

export async function readHubView(
  home: string,
  { secrets, now }: HubViewInput,
): Promise<McpHubView> {
  const [hub, health, configs, calls] = await Promise.all([
    readHub(home),
    readHubHealth(home),
    readHubConfigs(home, home),
    callsSince(home, new Date(now.getTime() - daysToMs(WEEK_DAYS))),
  ]);
  const plan = planSync(hub, configs);
  const servers: McpHubServerView[] = [];
  for (const server of hub.servers) {
    servers.push({
      ...serverFields(server, health),
      agents: agentsOf(hub, server.name),
      secretsHeld: await heldOf(server, secrets),
      callsThisWeek: calls.get(server.name) ?? 0,
    });
  }
  return {
    servers,
    agents: configs.flatMap((config) =>
      config.agent === undefined ? [] : [{ agent: config.agent, path: config.path }],
    ),
    ...entriesOf(plan),
  };
}

type ServerFields = Omit<McpHubServerView, 'agents' | 'secretsHeld' | 'callsThisWeek'>;

function serverFields(server: HubServer, health: HubHealth): ServerFields {
  const last = health[server.name] ?? { state: MCP_HEALTH.UNKNOWN };
  const tools = last.tools ?? [];
  return {
    name: server.name,
    ...(server.description === undefined ? {} : { description: server.description }),
    transport: server.transport,
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(server.args === undefined ? {} : { args: [...server.args] }),
    ...(server.url === undefined ? {} : { url: server.url }),
    envNames: Object.keys(server.env),
    // A remote server is written as its address, which no proxy stands in front of yet.
    governed: server.transport === HUB_TRANSPORT.STDIO,
    toolCount: tools.length,
    ...(tools.length === 0 ? {} : { tools }),
    health: {
      state: last.state,
      ...(last.checkedAt === undefined ? {} : { checkedAt: last.checkedAt }),
      ...(last.error === undefined ? {} : { error: last.error }),
    },
  };
}

/** Whether each named secret is in the OS store; the value is looked at and dropped here. */
async function heldOf(
  server: HubServer,
  secrets: SecretStore,
): Promise<Record<string, boolean>> {
  const held: Record<string, boolean> = {};
  for (const name of Object.values(server.secrets))
    // A store that cannot be read holds nothing as far as the screen can tell, which is what it shows.
    held[name] = (await secrets.get(name).catch(() => undefined)) !== undefined;
  return held;
}

function entriesOf(plan: SyncPlan): Pick<McpHubView, 'found' | 'drifted' | 'skipped'> {
  const found: McpHubEntryView[] = [];
  const drifted: McpHubEntryView[] = [];
  const skipped: McpHubEntryView[] = [];
  for (const file of plan.files) {
    const where = {
      path: file.path,
      ...(file.agent === undefined ? {} : { agent: file.agent }),
    };
    found.push(...file.found.map((name) => ({ ...where, name })));
    drifted.push(...file.drifted.map(({ name, kind }) => ({ ...where, name, kind })));
    skipped.push(...file.skipped.map(({ name, reason }) => ({ ...where, name, reason })));
  }
  return { found, drifted, skipped };
}

/** Calls through the proxy per server this week; the proxy names the server as each row's target. */
async function callsSince(home: string, since: Date): Promise<Map<string, number>> {
  // No ledger yet is a machine where nothing has called a server, so it counts as none.
  const events = await withEvents(home, (store) =>
    store.query({
      surface: EVENT_SURFACE.MCP,
      since: since.toISOString(),
      limit: LEDGER_SCAN_LIMIT,
    }),
  ).catch((): MemnoxEvent[] => []);
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.operation.startsWith(MCP_OPERATION_PREFIX) || event.target === undefined)
      continue;
    counts.set(event.target, (counts.get(event.target) ?? 0) + 1);
  }
  return counts;
}
