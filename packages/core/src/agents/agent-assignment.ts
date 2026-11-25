import type { Policy } from '../policy/policy';

/**
 * Which agent each install belongs to, as Memnox Cloud says, trusted only while its lease is
 * fresh, so one agent's rules reach its installs alone and a stale one fails closed.
 */

/** How a rule names one agent among `roles`, so it never collides with a role a person typed. */
export const AGENT_SCOPE_PREFIX = 'agent:';

export function agentScopeRole(profileId: string): string {
  return `${AGENT_SCOPE_PREFIX}${profileId}`;
}

/** Whether a rule was written for one agent, which is what the gate must never apply by guess. */
export function isAgentScoped(policy: Pick<Policy, 'match'>): boolean {
  return (policy.match.roles ?? []).some((role) =>
    role.replace(/^!/, '').startsWith(AGENT_SCOPE_PREFIX),
  );
}

/** Every agent a rule set names, so a held action can be tested against all of them at once. */
export function agentScopeRolesIn(policies: readonly Pick<Policy, 'match'>[]): string[] {
  const roles = new Set<string>();
  for (const policy of policies) {
    for (const role of policy.match.roles ?? []) {
      if (role.startsWith(AGENT_SCOPE_PREFIX)) roles.add(role);
    }
  }
  return [...roles];
}

export const ASSIGNMENT_SCOPE = {
  /** One install, named the ways this machine may call it. Wins over a machine wide one. */
  AGENT: 'agent',
  /** Every install on this machine that has no assignment of its own. */
  MACHINE: 'machine',
} as const;

export type AssignmentScope = (typeof ASSIGNMENT_SCOPE)[keyof typeof ASSIGNMENT_SCOPE];

export interface AgentAssignment {
  /** Stable for one install or one machine, so a change of agent is seen as a change. */
  id: string;
  scope: AssignmentScope;
  /** The names a gate on this machine may run under for this install. Agent scope only. */
  names?: string[];
  /** The agent it belongs to. */
  profile: string;
  /** The agent's own role, which a person's rules may also name. */
  role?: string;
}

/** What the cloud sends in a bundle: this machine's assignments and nobody else's. */
export interface AssignmentBlock {
  /** Rises on every bind, move, removal, retirement and revocation in the workspace. */
  version: number;
  /** How long this machine may rely on it without hearing from the cloud again. */
  leaseSeconds: number;
  assignments: AgentAssignment[];
}

/**
 * The longest any install relies on an assignment it has not had confirmed, whatever a
 * bundle asks for: ten minutes outlasts a dropped connection and bounds how long a moved
 * install could still act under the agent it left.
 */
export const ASSIGNMENT_LEASE_SECONDS_MAX = 10 * 60;

/** The clocks a lease is read against, handed in so a test controls both. */
export interface AssignmentClock {
  /** Wall time in milliseconds. A person can move it. */
  wall: number;
  /** Monotonic time in milliseconds since boot, shared by every process on this machine. */
  mono: number;
}

export function systemClock(): AssignmentClock {
  return { wall: Date.now(), mono: Number(process.hrtime.bigint() / 1_000_000n) };
}

/** The assignments this machine holds, and when and how they were last confirmed. */
export interface HeldAssignments {
  block: AssignmentBlock;
  confirmedAtWall: number;
  confirmedAtMono: number;
  /** The latest wall time this machine has seen, so turning the clock back is caught. */
  highWaterWall: number;
  /** Set when the cloud said something changed and the new bundle has not landed yet. */
  pendingSince?: number;
  /** When each assignment last changed agent, so permission given under the old one lapses. */
  since: Record<string, number>;
}

export const STANDING = {
  /** Fresh and unambiguous: these roles are the install's own. */
  CURRENT: 'current',
  /** Fresh, and this install belongs to no agent: no agent's rules apply to it. */
  NONE: 'none',
  /** The cloud said it changed, and the new one has not been applied. */
  STALE: 'stale',
  /** Not heard from the cloud within the lease, or the clock was turned back. */
  EXPIRED: 'expired',
  /** Never confirmed here, or not since this machine restarted. */
  UNCONFIRMED: 'unconfirmed',
  /** Two agents claim this install, which only a person can settle. */
  AMBIGUOUS: 'ambiguous',
} as const;

export type StandingState = (typeof STANDING)[keyof typeof STANDING];

export type AssignmentStanding =
  | {
      state: typeof STANDING.CURRENT;
      roles: string[];
      profile: string;
      version: number;
      /** Permission a person gave before this moment was given under another agent. */
      since: number;
    }
  | { state: typeof STANDING.NONE; version: number }
  | {
      state:
        | typeof STANDING.STALE
        | typeof STANDING.EXPIRED
        | typeof STANDING.UNCONFIRMED
        | typeof STANDING.AMBIGUOUS;
      reason: string;
    };

/** Whether the gate may trust this standing, or must hold what an agent's rule covers. */
export function isTrusted(standing: AssignmentStanding): boolean {
  return standing.state === STANDING.CURRENT || standing.state === STANDING.NONE;
}

/** The lease in milliseconds, never longer than the ceiling and never negative. */
function leaseMs(block: AssignmentBlock): number {
  const asked = Number.isFinite(block.leaseSeconds) ? block.leaseSeconds : 0;
  return Math.max(0, Math.min(asked, ASSIGNMENT_LEASE_SECONDS_MAX)) * 1000;
}

/**
 * Why a held block may not be relied on now: either clock past the lease, a wall clock behind
 * one already seen, or a restart. Moving the clock either way can only end a lease.
 */
export function leaseProblem(
  held: HeldAssignments,
  clock: AssignmentClock,
): AssignmentStanding | null {
  if (held.pendingSince !== undefined) {
    return {
      state: STANDING.STALE,
      reason: 'Memnox Cloud changed which agent its installs belong to',
    };
  }
  const lease = leaseMs(held.block);
  if (clock.mono < held.confirmedAtMono) {
    return {
      state: STANDING.UNCONFIRMED,
      reason: 'this computer restarted since Memnox Cloud last confirmed its agents',
    };
  }
  if (clock.wall < held.highWaterWall) {
    return { state: STANDING.EXPIRED, reason: "this computer's clock was turned back" };
  }
  if (
    clock.mono - held.confirmedAtMono >= lease ||
    clock.wall - held.confirmedAtWall >= lease
  ) {
    return {
      state: STANDING.EXPIRED,
      reason: 'Memnox Cloud has not confirmed its agents recently',
    };
  }
  return null;
}

/** Whether one install name is this gate's, counting the `agt_` key the ledger uses. */
function namesInclude(names: readonly string[] | undefined, agentName: string): boolean {
  if (names === undefined) return false;
  return names.some((name) => name === agentName || name === `agt_${agentName}`);
}

/**
 * The agent this gate's install belongs to. An assignment naming this install wins over the
 * machine wide one; two naming it for different agents is a conflict and trusted for neither.
 * It never returns another install's agent, since a machine can run several.
 */
export function assignmentStandingFor(
  held: HeldAssignments | null,
  agentName: string,
  clock: AssignmentClock,
): AssignmentStanding {
  if (held === null) {
    return {
      state: STANDING.UNCONFIRMED,
      reason:
        'Memnox Cloud has not told this computer which agent its installs belong to',
    };
  }
  const problem = leaseProblem(held, clock);
  if (problem !== null) return problem;
  const chosen = chosenFor(held.block.assignments, agentName);
  if ('reason' in chosen) return chosen;
  if (chosen.assignment === undefined)
    return { state: STANDING.NONE, version: held.block.version };
  const { profile, role, id } = chosen.assignment;
  return {
    state: STANDING.CURRENT,
    roles: [agentScopeRole(profile), ...(role === undefined ? [] : [role])],
    profile,
    version: held.block.version,
    since: held.since[id] ?? held.confirmedAtWall,
  };
}

/** The install's own assignment over the machine wide one, or the conflict that trusts neither. */
function chosenFor(
  assignments: readonly AgentAssignment[],
  agentName: string,
):
  | { assignment: AgentAssignment | undefined }
  | { state: typeof STANDING.AMBIGUOUS; reason: string } {
  const own = assignments.filter(
    (each) =>
      each.scope === ASSIGNMENT_SCOPE.AGENT && namesInclude(each.names, agentName),
  );
  if (new Set(own.map((each) => each.profile)).size > 1) {
    return {
      state: STANDING.AMBIGUOUS,
      reason: 'more than one agent claims this install',
    };
  }
  const machineWide = assignments.filter(
    (each) => each.scope === ASSIGNMENT_SCOPE.MACHINE,
  );
  if (own.length === 0 && new Set(machineWide.map((each) => each.profile)).size > 1) {
    return {
      state: STANDING.AMBIGUOUS,
      reason: 'more than one agent claims this whole computer',
    };
  }
  return { assignment: own[0] ?? machineWide[0] };
}

/** What a block from the network must look like before it is kept; anything else is no block. */
export function assignmentBlockFrom(value: unknown): AssignmentBlock | null {
  if (typeof value !== 'object' || value === null) return null;
  // Narrowed to an object above, and every field read is checked below.
  const raw = value as Record<string, unknown>;
  const version = raw['version'];
  const leaseSeconds = raw['leaseSeconds'];
  const list = raw['assignments'];
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  if (typeof leaseSeconds !== 'number' || !Number.isFinite(leaseSeconds)) return null;
  if (!Array.isArray(list)) return null;
  const assignments: AgentAssignment[] = [];
  for (const entry of list) {
    const read = assignmentFrom(entry);
    // One unreadable entry refuses the block, since dropping it could unassign an install quietly.
    if (read === null) return null;
    assignments.push(read);
  }
  return { version, leaseSeconds, assignments };
}

const ID_PATTERN = /^[\w.:@-]{1,128}$/;
const ROLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function assignmentFrom(value: unknown): AgentAssignment | null {
  if (typeof value !== 'object' || value === null) return null;
  // Narrowed to an object above, and every field read is checked below.
  const raw = value as Record<string, unknown>;
  const { id, scope, names, profile, role } = raw;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (typeof profile !== 'string' || !ID_PATTERN.test(profile)) return null;
  if (scope !== ASSIGNMENT_SCOPE.AGENT && scope !== ASSIGNMENT_SCOPE.MACHINE) return null;
  if (role !== undefined && (typeof role !== 'string' || !ROLE_PATTERN.test(role)))
    return null;
  let named: string[] | undefined;
  if (scope === ASSIGNMENT_SCOPE.AGENT) {
    if (!Array.isArray(names) || names.length === 0) return null;
    if (!names.every((name) => typeof name === 'string' && name.length > 0)) return null;
    named = names.map(String);
  }
  return {
    id,
    scope,
    profile,
    ...(named === undefined ? {} : { names: named }),
    ...(typeof role === 'string' ? { role } : {}),
  };
}
