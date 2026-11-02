import { basename, join } from 'node:path';
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
  type AgentsScanView,
  type CapabilityTally,
  type DiscoveryReport,
  type EnvironmentSnapshot,
  type Surface,
  type ToolLists,
} from '@memnox/core';
import { displayName, readNames } from '../agents/names';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { sessionsTool } from './sessions-tool';
import { MACHINE } from '../this-machine';

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
const fullRuns = new Map<string, Promise<DiscoveryReport | null>>();
/** What waits on that scan for each home, the screen put up again or nothing, for a test to wait on. */
const behind = new Map<string, Promise<void>>();

export async function showAgentsTool(
  deps: SessionToolDeps,
  args: ToolArgs,
  given: Partial<AgentsScan> = {},
): Promise<unknown> {
  const seams: AgentsScan = { ...LIVE_AGENTS_SCAN, ...given };
  const reading = await quickReading(deps.home, seams);
  if (reading === null) {
    return { shown: false, said: `The scan found no agents on this ${MACHINE}.` };
  }
  const title = textArg(args, 'title') ?? 'Your agents';
  const shown = await showOn(deps, title, reading);
  if (!reading.counted) {
    countBehind(deps.home, seams.full, async (report) => {
      await showOn(deps, title, { report, snapshot: null, counted: true });
    });
  }
  return {
    shown: true,
    agents: shown.agents.map(({ name, servers, reaches, working, open, mcp, clis }) => ({
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

/**
 * The agents the scan finds now with their counted facts, read and never put on screen, for the daemon's
 * AGENTS_SCAN. Null when there is no agent. A server never asked is counted behind the answer, so asking
 * again a moment later has the figure; until then `total` is absent, never zero.
 */
export async function readAgentsScan(
  deps: SessionToolDeps,
  given: Partial<AgentsScan> = {},
): Promise<AgentsScanView | null> {
  const seams: AgentsScan = { ...LIVE_AGENTS_SCAN, ...given };
  const reading = await quickReading(deps.home, seams);
  if (reading === null) return null;
  if (!reading.counted) countBehind(deps.home, seams.full, async () => undefined);
  return countedNodes(deps, reading);
}

interface Reading {
  report: DiscoveryReport;
  snapshot: EnvironmentSnapshot | null;
  counted: boolean;
}

/** The machine as it is now, starting nothing, and whether every server on it has been asked before. */
async function quickReading(home: string, seams: AgentsScan): Promise<Reading | null> {
  const [report, snapshot, lists] = await Promise.all([
    seams.scan(home),
    seams.heard(home).catch(() => null),
    seams.lists(home).catch((): ToolLists => ({})),
  ]);
  if (report === null || report.agents.length === 0) return null;
  const counted = unaskedServers(report.surfaces, lists, snapshot).length === 0;
  return { report, snapshot, counted };
}

/** Each agent with its share of the machine's real capabilities, so the shares add up to the machine. */
async function countedNodes(
  deps: SessionToolDeps,
  reading: Reading,
): Promise<AgentsScanView> {
  const capabilities = capabilitiesOf(reading.report);
  const nodes = await nodesOf(deps, reading.report, reading.snapshot);
  const credited = creditedTallies(
    capabilities,
    nodes.map((node) => node.id),
    reading.counted,
  );
  return {
    agents: nodes.map((node) => ({
      ...node,
      capabilities: credited.get(node.id) ?? tallyOf([], reading.counted),
    })),
    capabilities: tallyOf(capabilities, reading.counted),
  };
}

/** Puts the screen up, or puts it up again with the counted figure. */
async function showOn(
  deps: SessionToolDeps,
  title: string,
  reading: Reading,
): Promise<AgentsScanView> {
  const counted = await countedNodes(deps, reading);
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.AGENTS,
    sessionId: 'scan',
    agent: 'memnox',
    title,
    agents: counted.agents,
    capabilities: counted.capabilities,
    at: deps.now().toISOString(),
  });
  return counted;
}

/**
 * The full scan, behind the answer, started once per home however many ask; each asker's `then` runs on what it
 * found. A failure leaves whatever was shown saying it is counting, which is true.
 */
function countBehind(
  home: string,
  full: AgentsScan['full'],
  then: (report: DiscoveryReport) => Promise<void>,
): void {
  let run = fullRuns.get(home);
  if (run === undefined) {
    run = full(home)
      .catch(() => null)
      .finally(() => fullRuns.delete(home));
    fullRuns.set(home, run);
  }
  const found = run;
  const next = Promise.all([
    behind.get(home),
    found.then(async (report) => {
      if (report !== null && report.agents.length > 0) await then(report);
    }),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  behind.set(home, next);
  void next.finally(() => {
    if (behind.get(home) === next) behind.delete(home);
  });
}

/** Settles when the full scan behind the screen has, for a test to wait on. */
export async function countedBehind(home: string): Promise<void> {
  await behind.get(home);
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
  const launches = new Map<string, string | undefined>();
  for (const one of surfaces.flatMap((each) => each.servers ?? [])) {
    if (!launches.has(one.name)) launches.set(one.name, programOf(one.command));
  }
  const held = surfaces.flatMap((each) => each.tools ?? []);
  return [...launches].map(([name, program]) => {
    const named = program === undefined ? { name } : { name, command: program };
    const own = held.filter((tool) => tool.server === name);
    const tools =
      own.length > 0
        ? own
        : (snapshot?.servers.find((each) => each.name === name)?.tools ?? []);
    if (tools.length === 0) return named;
    const unique = new Map(tools.map((tool) => [tool.name, tool.effect]));
    const changing = [...unique.values()].filter(
      (effect) => effect === TOOL_EFFECT.WRITE || effect === TOOL_EFFECT.DESTRUCTIVE,
    ).length;
    return { ...named, tools: unique.size, changing };
  });
}

/** The program a server starts by file name only, since the whole path names the user. */
function programOf(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : basename(trimmed);
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
