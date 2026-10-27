import type { AgentHost, HostLocation, HostSignatureState } from './agent-host';
import type { ApprovalState } from './approval-posture';
import type { DiscoveryReport } from './discover';
import { URL_SERVER_COMMAND } from './detectors/mcp-config';
import type { McpServerLaunch, Surface } from './surface';
import { isOwnServer, isWrapped } from './wrap';
import {
  EFFECT_INFERENCE,
  SURFACE_KIND,
  type ResourceKind,
  type Sensitivity,
  type SurfaceKind,
  type ToolEffect,
} from './discovery.constants';

/**
 * What the machine held at one moment, reduced to the fields a later comparison can
 * read. Never the whole report: a snapshot is kept for weeks, so it carries names,
 * counts and fingerprints and nothing that was inside a file.
 */
export interface EnvironmentSnapshot {
  takenAt: string;
  agents: SnapshotAgent[];
  servers: SnapshotServer[];
  resources: SnapshotResource[];
  /** Absent on a snapshot kept before hooks were read, so none of them reads as new. */
  hooks?: SnapshotHook[];
}

/** A hook as it is kept: what runs and when, never the command line. */
export interface SnapshotHook {
  id: string;
  host: string;
  event: string;
  program: string;
  declaredIn: string;
  plugin?: string;
  gate: boolean;
  feedsModel: boolean;
  own: boolean;
}

export interface SnapshotAgent {
  id: string;
  kind: string;
  /** So an update is named as the cause of what it changed, rather than raised as an alarm. */
  version?: string;
  /** One entry per surface kind, so a widened surface is a comparison and not a guess. */
  surfaces: SnapshotSurface[];
  /**
   * Present only for a harness. A role that appeared overnight is the drift a
   * per-agent roster cannot see, so the membership is kept rather than the count.
   */
  harness?: SnapshotHarness;
  /** Whether it asks before acting. Absent on a scan kept before this was read. */
  approval?: ApprovalState;
  /** Where its binary lives and who signed it, never the path, which names the user. */
  host?: SnapshotHost;
}

export interface SnapshotHost {
  location: HostLocation;
  signature: HostSignatureState;
  signer?: string;
}

export interface SnapshotHarness {
  runtimes: string[];
  roles: string[];
  hooks: string[];
  federated: boolean;
}

export interface SnapshotSurface {
  kind: SurfaceKind;
  /** The file that proved it, which is the answer to "who granted this". */
  detectedFrom: string;
}

export interface SnapshotServer {
  name: string;
  /** The config file that launches it. Provenance for authority, not just for code. */
  grantedBy: string;
  agentIds: string[];
  tools: SnapshotTool[];
  /**
   * Whether every config that launches it routes it through the proxy. One agent
   * launching it bare is enough to make it ungoverned, because that agent reaches it
   * with nothing in the way. Absent on snapshots kept before this was recorded.
   */
  wrapped?: boolean;
  /** How it is reached. A launch line is stdio; a server named by URL is http. */
  transport?: McpTransport;
}

export const MCP_TRANSPORT = {
  STDIO: 'stdio',
  HTTP: 'http',
} as const;

export type McpTransport = (typeof MCP_TRANSPORT)[keyof typeof MCP_TRANSPORT];

export interface SnapshotTool {
  name: string;
  effect: ToolEffect;
}

export interface SnapshotResource {
  id: string;
  kind: ResourceKind;
  /** Absent for a resource that is not a file, such as the network or a database URL. */
  path?: string;
  sensitivity: Sensitivity;
  reachableBy: string[];
}

/** Reduces a report to what survives being kept. Pure: the clock is an argument. */
export function snapshotOf(
  report: DiscoveryReport,
  takenAt: string,
): EnvironmentSnapshot {
  return {
    takenAt,
    agents: report.agents.map((agent) => snapshotAgentOf(report, agent)),
    servers: serversIn(report),
    resources: report.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      ...(resource.path === undefined ? {} : { path: resource.path }),
      sensitivity: resource.sensitivity,
      reachableBy: resource.reachableBy.map((ref) => ref.id),
    })),
    hooks: report.hooks.map((hook) => ({
      id: hook.id,
      host: hook.host,
      event: hook.event,
      program: hook.program,
      declaredIn: hook.declaredIn,
      ...(hook.plugin === undefined ? {} : { plugin: hook.plugin }),
      gate: hook.gate,
      feedsModel: hook.feedsModel,
      own: hook.own,
    })),
  };
}

/** One agent as it is kept: its surfaces by kind, a harness's membership, and its standing. */
function snapshotAgentOf(
  report: DiscoveryReport,
  agent: DiscoveryReport['agents'][number],
): SnapshotAgent {
  const harness = report.harnesses.find((each) => each.agentId === agent.id);
  return {
    id: agent.id,
    kind: agent.kind,
    ...(agent.version === undefined ? {} : { version: agent.version }),
    ...(agent.approval === undefined ? {} : { approval: agent.approval.state }),
    ...(agent.host === undefined ? {} : { host: snapshotHostOf(agent.host) }),
    surfaces: report.surfaces
      .filter((surface) => surface.agentId === agent.id)
      .map((surface) => ({ kind: surface.kind, detectedFrom: surface.detectedFrom })),
    ...(harness === undefined
      ? {}
      : {
          harness: {
            runtimes: [...harness.runtimes],
            roles: [...harness.roles],
            hooks: [...harness.hooks],
            federated: harness.federated,
          },
        }),
  };
}

/** The binary without its path, which names the user. */
function snapshotHostOf(host: AgentHost): SnapshotHost {
  return {
    location: host.location,
    signature: host.signature.state,
    ...(host.signature.signer === undefined ? {} : { signer: host.signature.signer }),
  };
}

/** Through the proxy, or Memnox's own server, which needs nothing in front of it. */
function isGoverned(launch: Parameters<typeof isWrapped>[0]): boolean {
  return isWrapped(launch) || isOwnServer(launch);
}

/** One row per server, whichever agents launch it, with the config that named it. */
function serversIn(report: DiscoveryReport): SnapshotServer[] {
  const byName = new Map<string, SnapshotServer>();

  for (const surface of report.surfaces) {
    if (surface.kind !== SURFACE_KIND.MCP) continue;
    for (const launch of surface.servers ?? []) {
      const existing = byName.get(launch.name);
      if (existing === undefined) {
        byName.set(launch.name, {
          name: launch.name,
          grantedBy: surface.detectedFrom,
          agentIds: [surface.agentId],
          tools: [],
          wrapped: isGoverned(launch),
          transport: transportOf(launch),
        });
        continue;
      }
      if (!existing.agentIds.includes(surface.agentId)) {
        existing.agentIds.push(surface.agentId);
      }
      // One bare launch is an agent with nothing in its way, so it decides.
      existing.wrapped = existing.wrapped === true && isGoverned(launch);
    }
    for (const tool of surface.tools ?? []) {
      const server = byName.get(tool.server);
      if (server === undefined) continue;
      if (server.tools.some((each) => each.name === tool.name)) continue;
      server.tools.push({ name: tool.name, effect: tool.effect });
    }
  }
  return [...byName.values()];
}

/** Names only: the URL itself can carry a token, so it never leaves this function. */
function transportOf(launch: McpServerLaunch): McpTransport {
  return launch.command === URL_SERVER_COMMAND ? MCP_TRANSPORT.HTTP : MCP_TRANSPORT.STDIO;
}

/**
 * The tools a probed scan found, put back onto the surfaces of an unprobed one, because
 * only `scan` starts MCP servers and `doctor` and `protect` still need to know the tools.
 */
export function withToolsFrom(
  surfaces: readonly Surface[],
  snapshot: EnvironmentSnapshot | null,
): Surface[] {
  if (snapshot === null) return [...surfaces];
  return surfaces.map((surface) => {
    if ((surface.tools ?? []).length > 0) return surface;
    const names = new Set((surface.servers ?? []).map((server) => server.name));
    if (names.size === 0) return surface;
    const tools = snapshot.servers
      .filter(
        (server) => names.has(server.name) && server.agentIds.includes(surface.agentId),
      )
      .flatMap((server) =>
        server.tools.map((tool) => ({
          server: server.name,
          name: tool.name,
          effect: tool.effect,
          // Read back from a record rather than inferred here, and it says so.
          inferredFrom: EFFECT_INFERENCE.PROBE,
        })),
      );
    return tools.length === 0 ? surface : { ...surface, tools };
  });
}

/** The newest snapshot that actually enumerated tools, or null when none ever did. */
export function lastProbed(
  history: readonly EnvironmentSnapshot[],
): EnvironmentSnapshot | null {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const snapshot = history[at] as EnvironmentSnapshot;
    if (snapshot.servers.some((server) => server.tools.length > 0)) return snapshot;
  }
  return null;
}
