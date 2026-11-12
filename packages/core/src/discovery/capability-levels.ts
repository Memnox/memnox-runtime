import {
  CONNECTION_KIND,
  CONNECTION_STATUS,
  MEDIATION,
  type AgentConnection,
} from '../agents/agent-connection';
import { SURFACE_KIND, type SurfaceKind } from './discovery.constants';
import { PROOF, type SeamProof } from './enforcement';
import type { AgentProof } from './proof-record';

/**
 * How sure Memnox is of each thing an agent does, computed from what holds it and what was proved,
 * never claimed. Only a seam that refused a planted test is enforced; anything else says less.
 */

export const CAPABILITY_LEVEL = {
  /** A seam in front of it refused a planted test: "Memnox stops this". */
  ENFORCED: 'enforced',
  /** Something is in front of it with no test passed: "Memnox checks this". */
  MEDIATED: 'mediated',
  /** The agent asks Memnox and could act without asking: "The agent asks Memnox". */
  ADVISORY: 'advisory',
  /** Seen in the record with nothing in front of it: "Memnox only sees this". */
  OBSERVED: 'observed',
  /** No evidence at all: "Outside Memnox". */
  NONE: 'none',
} as const;

export type CapabilityLevel = (typeof CAPABILITY_LEVEL)[keyof typeof CAPABILITY_LEVEL];

/** Weakest first, so the weaker of two levels is the one with the lower index. */
const LEVEL_ORDER: readonly CapabilityLevel[] = [
  CAPABILITY_LEVEL.NONE,
  CAPABILITY_LEVEL.OBSERVED,
  CAPABILITY_LEVEL.ADVISORY,
  CAPABILITY_LEVEL.MEDIATED,
  CAPABILITY_LEVEL.ENFORCED,
];

/** The seams enforcement is broken down by, each the surface a proof names. */
export const ENFORCEMENT_SEAM = {
  SHELL: SURFACE_KIND.SHELL,
  FILES: SURFACE_KIND.FILESYSTEM,
  GIT: SURFACE_KIND.GIT,
  NETWORK: SURFACE_KIND.NETWORK,
  BROWSER: SURFACE_KIND.BROWSER,
  MCP: SURFACE_KIND.MCP,
} as const;

export type EnforcementSeam = (typeof ENFORCEMENT_SEAM)[keyof typeof ENFORCEMENT_SEAM];

const SEAMS: readonly EnforcementSeam[] = Object.values(ENFORCEMENT_SEAM);

/** The strategy's seven capabilities, enforcement by seam. */
export interface CapabilityLevels {
  context: CapabilityLevel;
  instructions: CapabilityLevel;
  tools: CapabilityLevel;
  activity: CapabilityLevel;
  coordination: CapabilityLevel;
  approval: CapabilityLevel;
  enforcement: Record<EnforcementSeam, CapabilityLevel>;
}

/** What one connection's levels are read from. */
export interface LevelEvidence {
  connection: Pick<AgentConnection, 'kind' | 'mediation'>;
  /** This agent's line of the last `memnox doctor --prove`, where one ran. */
  proof?: AgentProof;
  /** That run's result per seam. */
  seams?: readonly SeamProof[];
  /** The enforcement path that proof ran against, as its record keeps it. */
  proofDigest?: string;
  /** The enforcement path installed now; a proof counts only while the two match. */
  currentDigest?: string;
  /** The ledger holds something this agent did. */
  seen: boolean;
}

/** Surfaces every own hook rules on, so a hooked agent with no proof run is checked there and no further. */
const HOOK_SURFACES: readonly SurfaceKind[] = [SURFACE_KIND.FILESYSTEM, SURFACE_KIND.MCP];

export function levelsOf(evidence: LevelEvidence): CapabilityLevels {
  // Cast is safe: one entry is built for every seam there is.
  const enforcement = Object.fromEntries(
    SEAMS.map((seam) => [seam, seamLevel(evidence, seam)]),
  ) as Record<EnforcementSeam, CapabilityLevel>;
  const general = generalLevel(evidence);
  return {
    context: general,
    instructions: general,
    tools: enforcement[ENFORCEMENT_SEAM.MCP],
    activity: general,
    coordination:
      evidence.connection.kind === CONNECTION_KIND.RUNTIME_MCP_PROXY
        ? seenOnly(evidence)
        : general,
    // A call is held where a seam sits, so asking is as strong as the strongest seam and no stronger.
    approval: strongest(Object.values(enforcement)),
    enforcement,
  };
}

/** What the connection itself can do for everything but a seam: check, be asked, or only see. */
function generalLevel(evidence: LevelEvidence): CapabilityLevel {
  if (evidence.connection.mediation === MEDIATION.INTERPOSED)
    return CAPABILITY_LEVEL.MEDIATED;
  if (evidence.connection.mediation === MEDIATION.ADVISORY)
    return CAPABILITY_LEVEL.ADVISORY;
  return seenOnly(evidence);
}

function seenOnly(evidence: LevelEvidence): CapabilityLevel {
  return evidence.seen ? CAPABILITY_LEVEL.OBSERVED : CAPABILITY_LEVEL.NONE;
}

function seamLevel(evidence: LevelEvidence, seam: EnforcementSeam): CapabilityLevel {
  const { connection, proof } = evidence;
  if (connection.mediation === MEDIATION.ADVISORY) return CAPABILITY_LEVEL.ADVISORY;
  if (connection.mediation !== MEDIATION.INTERPOSED) return seenOnly(evidence);
  if (
    connection.kind === CONNECTION_KIND.GUARD ||
    connection.kind === CONNECTION_KIND.GATEWAY
  )
    return CAPABILITY_LEVEL.MEDIATED;
  if (proof !== undefined && proofIsCurrent(evidence))
    return provedLevel(evidence, proof, seam);
  const held =
    connection.kind === CONNECTION_KIND.RUNTIME_MCP_PROXY
      ? seam === SURFACE_KIND.MCP
      : HOOK_SURFACES.includes(seam);
  return held ? CAPABILITY_LEVEL.MEDIATED : seenOnly(evidence);
}

/** A proof run against another path proves nothing about this one, so it is read as no proof. */
function proofIsCurrent(evidence: LevelEvidence): boolean {
  return (
    evidence.proofDigest !== undefined &&
    evidence.currentDigest !== undefined &&
    evidence.proofDigest === evidence.currentDigest
  );
}

/** Enforced only where the seam was tested on this agent and refused; held without that is checked. */
function provedLevel(
  evidence: LevelEvidence,
  proof: AgentProof,
  seam: EnforcementSeam,
): CapabilityLevel {
  const result = (evidence.seams ?? []).find((each) => each.seam === seam);
  if (
    proof.tested.includes(seam) &&
    result !== undefined &&
    result.state === PROOF.ENFORCED
  )
    return CAPABILITY_LEVEL.ENFORCED;
  if (proof.installed.includes(seam)) return CAPABILITY_LEVEL.MEDIATED;
  return seenOnly(evidence);
}

function strongest(levels: readonly CapabilityLevel[]): CapabilityLevel {
  return levels.reduce(
    (best, each) => (LEVEL_ORDER.indexOf(each) > LEVEL_ORDER.indexOf(best) ? each : best),
    CAPABILITY_LEVEL.NONE,
  );
}

function weaker(one: CapabilityLevel, two: CapabilityLevel): CapabilityLevel {
  return LEVEL_ORDER.indexOf(one) <= LEVEL_ORDER.indexOf(two) ? one : two;
}

/** Every capability at none, which is what a profile with no agent behind it shows. */
export function noLevels(): CapabilityLevels {
  const none = CAPABILITY_LEVEL.NONE;
  return {
    context: none,
    instructions: none,
    tools: none,
    activity: none,
    coordination: none,
    approval: none,
    // Cast is safe: one entry is built for every seam there is.
    enforcement: Object.fromEntries(SEAMS.map((seam) => [seam, none])) as Record<
      EnforcementSeam,
      CapabilityLevel
    >,
  };
}

/**
 * A profile is only as sure as its weakest connection, so one unguarded agent under a job is never
 * hidden by a guarded one. Gone connections are left out; with none left, the profile is outside Memnox.
 */
export function profileLevelsOf(
  connections: readonly Pick<AgentConnection, 'status' | 'levels'>[],
): CapabilityLevels {
  const counted = connections
    .filter((each) => each.status !== CONNECTION_STATUS.GONE)
    .map((each) => each.levels ?? noLevels());
  const [first, ...rest] = counted;
  if (first === undefined) return noLevels();
  return rest.reduce(weakestOf, first);
}

function weakestOf(one: CapabilityLevels, two: CapabilityLevels): CapabilityLevels {
  return {
    context: weaker(one.context, two.context),
    instructions: weaker(one.instructions, two.instructions),
    tools: weaker(one.tools, two.tools),
    activity: weaker(one.activity, two.activity),
    coordination: weaker(one.coordination, two.coordination),
    approval: weaker(one.approval, two.approval),
    // Cast is safe: one entry is built for every seam there is.
    enforcement: Object.fromEntries(
      SEAMS.map((seam) => [seam, weaker(one.enforcement[seam], two.enforcement[seam])]),
    ) as Record<EnforcementSeam, CapabilityLevel>,
  };
}
