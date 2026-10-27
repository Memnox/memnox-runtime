import { join } from 'node:path';
import {
  areaPhrase,
  CachedMcpLister,
  capabilitiesOf,
  creditedTallies,
  DISPLAY,
  DisplayRequests,
  discover,
  MEMNOX_HOME,
  NodeMachineReader,
  NodeMcpLister,
  NodeSnapshotStore,
  NodeToolListCache,
  RecordingMcpLister,
  SURFACE_KIND,
  tallyOf,
  TOOL_EFFECT,
  unaskedServers,
  type AgentNode,
  type AgentServer,
  type CapabilityTally,
  type DiscoveryReport,
  type EnvironmentSnapshot,
  type Surface,
  type ToolLists,
} from '@memnox/core';
import { displayName, readNames } from '../agents/names';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { sessionsTool } from './sessions-tool';

/**
 * "Scan my computer and show me my agents" on the whole screen. It starts nothing and counts from
 * what the last full scan kept; a server never asked starts one behind the screen, which lands the count.
 */

/** Session rows as the sessions tool returns them, read for the two counts the screen shows. */
interface SessionRow {
  agent: string;
  state: string;
}

const SHOWN =
  'Every agent is on their whole screen now, each with its logo, its MCP servers by name with their tools, and the signed in command line tools its shell can run. Say in one or two sentences how many there are, naming them, and which reaches the most and through what, like "Five agents. Claude Code reaches the most: a shell with GitHub and Vercel signed in, and four MCP servers including Linear." Never read the lists out.';

/** The machine read three ways, injected so a test never starts a server or reads the real home. */
interface AgentsScan {
  /** Quick, starting nothing: MCP tools come from what was kept. */
  scan: (home: string) => Promise<DiscoveryReport | null>;
  heard: (home: string) => Promise<EnvironmentSnapshot | null>;
  lists: (home: string) => Promise<ToolLists>;
  /** Asks every server, keeps what each said, and answers with the counted report. */
  full: (home: string) => Promise<DiscoveryReport | null>;
}

const LIVE_AGENTS_SCAN: AgentsScan = {
  scan: liveScan,
  heard: lastHeard,
  lists: (home) => new NodeToolListCache(home).read(),
  full: fullScan,
};

/** One full scan per home at a time, so asking twice while it runs never starts every server twice. */
const counting = new Map<string, Promise<void>>();

export async function showAgentsTool(
  deps: SessionToolDeps,
  args: ToolArgs,
  given: Partial<AgentsScan> = {},
): Promise<unknown> {
  const seams: AgentsScan = { ...LIVE_AGENTS_SCAN, ...given };
  const [report, snapshot, lists] = await Promise.all([
    seams.scan(deps.home),
    seams.heard(deps.home).catch(() => null),
    seams.lists(deps.home).catch((): ToolLists => ({})),
  ]);
  if (report === null || report.agents.length === 0) {
    return { shown: false, said: 'The scan found no agents on this Mac.' };
  }
  const counted = unaskedServers(report.surfaces, lists, snapshot).length === 0;
  const title = textArg(args, 'title') ?? 'Your agents';
  const shown = await showOn(deps, title, { report, snapshot, counted });
  if (!counted) countBehind(deps, title, seams.full);
  return {
    shown: true,
    agents: shown.nodes.map(({ name, servers, reaches, working, open, mcp, clis }) => ({
      name,
      servers,
      reaches,
      working,
      open,
      mcp,
      clis,
    })),
    capabilities: shown.capabilities,
    said: saidFor(shown.capabilities),
  };
}

interface Reading {
  report: DiscoveryReport;
  snapshot: EnvironmentSnapshot | null;
  counted: boolean;
}

/** Puts the screen up, or puts it up again with the counted figure. */
async function showOn(
  deps: SessionToolDeps,
  title: string,
  reading: Reading,
): Promise<{ nodes: AgentNode[]; capabilities: CapabilityTally }> {
  const capabilities = capabilitiesOf(reading.report);
  const tally = tallyOf(capabilities, reading.counted);
  const nodes = await nodesOf(deps, reading.report, reading.snapshot);
  const credited = creditedTallies(
    capabilities,
    nodes.map((node) => node.id),
    reading.counted,
  );
  const withCounts = nodes.map((node) => ({
    ...node,
    capabilities: credited.get(node.id) ?? tallyOf([], reading.counted),
  }));
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.AGENTS,
    sessionId: 'scan',
    agent: 'memnox',
    title,
    agents: withCounts,
    capabilities: tally,
    at: deps.now().toISOString(),
  });
  return { nodes: withCounts, capabilities: tally };
}

/** The full scan, behind the screen; a failure leaves the screen saying it is counting, which is true. */
function countBehind(
  deps: SessionToolDeps,
  title: string,
  full: AgentsScan['full'],
): void {
  if (counting.has(deps.home)) return;
  const run = (async (): Promise<void> => {
    const report = await full(deps.home);
    if (report === null || report.agents.length === 0) return;
    await showOn(deps, title, { report, snapshot: null, counted: true });
  })()
    .catch(() => undefined)
    .finally(() => counting.delete(deps.home));
  counting.set(deps.home, run);
}

/** Settles when the full scan behind the screen has, for a test to wait on. */
export async function countedBehind(home: string): Promise<void> {
  await counting.get(home);
}

function saidFor(capabilities: CapabilityTally): string {
  if (capabilities.total === undefined) {
    return `${SHOWN} The real capabilities are still being counted, so say they are being counted and never give a number for them.`;
  }
  const areas = areaPhrase(capabilities.areas);
  return `${SHOWN} Then say ${capabilities.total} real capabilities${areas === null ? '' : `, across ${areas}`}, all within view.`;
}

/** Each agent with counted facts only, from the scan and the sessions on record. */
async function nodesOf(
  deps: SessionToolDeps,
  report: DiscoveryReport,
  snapshot: EnvironmentSnapshot | null,
): Promise<AgentNode[]> {
  const [names, rows] = await Promise.all([
    readNames(deps.home),
    sessionsTool(deps, { hours: '24' }) as Promise<SessionRow[]>,
  ]);
  return report.agents.map((agent) => {
    const surfaces = report.surfaces.filter((each) => each.agentId === agent.id);
    const servers = surfaces.reduce((sum, each) => sum + (each.servers?.length ?? 0), 0);
    const reaches = [...new Set(surfaces.map((each) => each.kind))].filter(
      (kind) => kind !== SURFACE_KIND.MCP,
    );
    const own = rows.filter((row) => sameProduct(row.agent, agent.kind));
    const shell = surfaces.some((each) => each.kind === SURFACE_KIND.SHELL);
    return {
      id: agent.id,
      kind: agent.kind,
      name: displayName(names, agent),
      servers,
      reaches,
      working: own.filter((row) => row.state === 'working').length,
      open: own.filter((row) => row.state === 'open').length,
      mcp: serversOf(surfaces, snapshot),
      // A signed in CLI is reach only through a shell, so an agent without one is never credited.
      clis: shell ? signedIn(report) : [],
    };
  });
}

/** Each server by name once, with the tool counts this scan holds, else what the last full scan heard. */
function serversOf(
  surfaces: readonly Surface[],
  snapshot: EnvironmentSnapshot | null,
): AgentServer[] {
  const names = [
    ...new Set(surfaces.flatMap((each) => (each.servers ?? []).map((one) => one.name))),
  ];
  const held = surfaces.flatMap((each) => each.tools ?? []);
  return names.map((name) => {
    const own = held.filter((tool) => tool.server === name);
    const tools =
      own.length > 0
        ? own
        : (snapshot?.servers.find((each) => each.name === name)?.tools ?? []);
    if (tools.length === 0) return { name };
    const unique = new Map(tools.map((tool) => [tool.name, tool.effect]));
    const changing = [...unique.values()].filter(
      (effect) => effect === TOOL_EFFECT.WRITE || effect === TOOL_EFFECT.DESTRUCTIVE,
    ).length;
    return { name, tools: unique.size, changing };
  });
}

function signedIn(report: DiscoveryReport): string[] {
  return [...new Set((report.authenticated ?? []).map((each) => each.name))];
}

/** What the last full scan heard each server say it holds; read, never asked again here. */
async function lastHeard(home: string): Promise<EnvironmentSnapshot | null> {
  return new NodeSnapshotStore(join(home, MEMNOX_HOME)).latest();
}

/** A session names its agent as `codex` where the scan says `codex-cli`, and both are Codex. */
function sameProduct(sessionAgent: string, kind: string): boolean {
  const bare = (value: string): string => value.replace(/^agt_/, '').replace(/-cli$/, '');
  return bare(sessionAgent) === bare(kind);
}

/** The machine as it is now, with no MCP server started: each one's tools are what was kept. */
async function liveScan(home: string): Promise<DiscoveryReport | null> {
  const [lists, snapshot] = await Promise.all([
    new NodeToolListCache(home).read(),
    lastHeard(home).catch(() => null),
  ]);
  return discover(new NodeMachineReader(home), {
    now: new Date().toISOString(),
    lister: new CachedMcpLister(lists, snapshot),
  }).catch(() => null);
}

/** Every server asked once, and what each said kept, so the next quick scan counts it at once. */
async function fullScan(home: string): Promise<DiscoveryReport | null> {
  const lister = new RecordingMcpLister(new NodeMcpLister());
  const report = await discover(new NodeMachineReader(home), {
    now: new Date().toISOString(),
    lister,
  });
  await new NodeToolListCache(home).merge(lister.heard);
  return report;
}
