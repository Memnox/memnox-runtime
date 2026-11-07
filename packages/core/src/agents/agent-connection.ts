import { agentNameIn } from '../discovery/agent';
import type { CapabilityLevels } from '../discovery/capability-levels';
import { defaultProfileIdFor } from './agent-profile';

/**
 * How Memnox reaches an agent, kept apart from the job it does. The kind and the mediation are
 * read off what this machine can see in front of the agent, and never taken from the agent.
 */

export const CONNECTION_KIND = {
  /** Its own hook, the interceptors, the shims or the proxy, all on this machine. */
  RUNTIME_HOOK: 'runtime_hook',
  /** Only the MCP servers it starts go through Memnox, as for Claude Desktop. */
  RUNTIME_MCP_PROXY: 'runtime_mcp_proxy',
  /** `@memnox/guard` wrapped round its tools in its own code. */
  GUARD: 'guard',
  /** The cloud gateway in front of its calls. */
  GATEWAY: 'gateway',
  /** It speaks to Memnox over MCP and reports what it does. */
  MCP: 'mcp',
  /** Found here with nothing in front of it, so it is only seen. */
  OBSERVED: 'observed',
} as const;

export type ConnectionKind = (typeof CONNECTION_KIND)[keyof typeof CONNECTION_KIND];

export const MEDIATION = {
  /** Its calls pass through Memnox before they run. */
  INTERPOSED: 'interposed',
  /** It asks Memnox and could act without asking. */
  ADVISORY: 'advisory',
  /** Memnox sees what it did after it did it, or only that it is here. */
  OBSERVED: 'observed',
} as const;

export type Mediation = (typeof MEDIATION)[keyof typeof MEDIATION];

export const CONNECTION_STATUS = {
  /** A session of it is working now. */
  LIVE: 'live',
  /** Found on the last scan with nothing running. */
  IDLE: 'idle',
  /** Bound once and not found any more. */
  GONE: 'gone',
} as const;

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

export interface AgentConnection {
  id: string;
  profileId: string;
  kind: ConnectionKind;
  agentKind?: string;
  /** The ledger key, `agt_<kind>`, which a binding never changes. */
  agentId?: string;
  mediation: Mediation;
  firstSeen: string;
  lastSeen: string;
  status: ConnectionStatus;
  /** How sure Memnox is of each capability through this connection, computed and never claimed. */
  levels?: CapabilityLevels;
}

/** A profile a person bound to an agent: the one thing about a connection that is stored. */
export interface ProfileBinding {
  profileId: string;
  boundAt: string;
}

/** By agent id. An agent absent here answers to its default profile. */
export type ProfileBindings = Readonly<Record<string, ProfileBinding>>;

/** What this machine knows of one detected agent, read off the scan, the hooks and its sessions. */
export interface ConnectionEvidence {
  agentId: string;
  agentKind: string;
  /** What Memnox could hold it through: its own hook, or the servers it starts. */
  seam?: 'hook' | 'servers';
  /** Whether that seam is in place now. */
  held: boolean;
  /** Sessions of it working now. */
  running: number;
  firstSeen: string;
  lastSeen: string;
}

const CONNECTION_ID_PREFIX = 'con_';

/** What a kind of connection can do, which is a fact about the kind and never a claim by the agent. */
export function mediationOf(kind: ConnectionKind): Mediation {
  if (kind === CONNECTION_KIND.MCP) return MEDIATION.ADVISORY;
  if (kind === CONNECTION_KIND.OBSERVED) return MEDIATION.OBSERVED;
  return MEDIATION.INTERPOSED;
}

/** A seam that is not in place yet holds nothing, so the agent is only seen until it is. */
export function connectionKindOf(evidence: ConnectionEvidence): ConnectionKind {
  if (!evidence.held || evidence.seam === undefined) return CONNECTION_KIND.OBSERVED;
  return evidence.seam === 'hook'
    ? CONNECTION_KIND.RUNTIME_HOOK
    : CONNECTION_KIND.RUNTIME_MCP_PROXY;
}

/** The profile an agent works under: the one a person bound, or its default until they do. */
export function profileIdFor(
  agentId: string,
  agentKind: string,
  bindings: ProfileBindings,
): string {
  return bindings[agentId]?.profileId ?? defaultProfileIdFor(agentKind);
}

/** One connection per detected agent, and one gone connection per bound agent no longer found. */
export function connectionsFor(
  found: readonly ConnectionEvidence[],
  bindings: ProfileBindings,
): AgentConnection[] {
  const seen = found.map((evidence) => connectionOf(evidence, bindings));
  const gone = Object.entries(bindings)
    .filter(([agentId]) => !found.some((each) => each.agentId === agentId))
    .map(([agentId, binding]) => goneConnection(agentId, binding));
  return [...seen, ...gone];
}

function connectionOf(
  evidence: ConnectionEvidence,
  bindings: ProfileBindings,
): AgentConnection {
  const kind = connectionKindOf(evidence);
  return {
    id: `${CONNECTION_ID_PREFIX}${evidence.agentKind}`,
    profileId: profileIdFor(evidence.agentId, evidence.agentKind, bindings),
    kind,
    agentKind: evidence.agentKind,
    agentId: evidence.agentId,
    mediation: mediationOf(kind),
    firstSeen: evidence.firstSeen,
    lastSeen: evidence.lastSeen,
    status: evidence.running > 0 ? CONNECTION_STATUS.LIVE : CONNECTION_STATUS.IDLE,
  };
}

/** Nothing is known of an agent that is not here any more, so it is only what was once seen. */
function goneConnection(agentId: string, binding: ProfileBinding): AgentConnection {
  const agentKind = agentNameIn(agentId);
  return {
    id: `${CONNECTION_ID_PREFIX}${agentKind}`,
    profileId: binding.profileId,
    kind: CONNECTION_KIND.OBSERVED,
    agentKind,
    agentId,
    mediation: MEDIATION.OBSERVED,
    firstSeen: binding.boundAt,
    lastSeen: binding.boundAt,
    status: CONNECTION_STATUS.GONE,
  };
}
