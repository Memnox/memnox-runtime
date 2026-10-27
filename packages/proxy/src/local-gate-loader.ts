import {
  FileAllowances,
  parentAgentsOf,
  ENV_AGENT_NAME,
  ENV_AGENT_ROLE,
  ENV_POLICIES,
  ENV_PRINCIPAL,
  LocalGate,
  loadPolicySet,
  readPolicyFiles,
  type Policy,
} from '@memnox/core';

import { MCP_ACTION_PREFIX } from './firewall.constants';

/**
 * Where the proxy finds its rules: the environment first, then the registry every other
 * seam reads, since an editor started from a dock icon carries no environment at all.
 */
export interface LocalGateEnvironment {
  policies?: string;
  agentName?: string;
  /** The job `memnox run --role` enrolled the agent under, which a rule's `roles:` matches. */
  agentRole?: string;
  /** The person `memnox run --for` named, which a rule's `principals:` matches. */
  principal?: string;
  /**
   * The agent `memnox mcp wrap` wrote into the line, so a pause on that agent stops this
   * server too. The environment's name wins, since `memnox run` knows the run.
   */
  wrappedFor?: string;
}

/**
 * Null leaves the static tool filters as the only
 * gate, which is what an unconfigured machine has.
 */
export async function loadLocalGate(
  environment: LocalGateEnvironment,
  serverName: string,
  home: string,
  warn: (message: string) => void = () => undefined,
): Promise<LocalGate | null> {
  const files = await readPolicyFiles(environment.policies, home);
  if (files.length === 0) return null;

  // Tolerant of a broken file: throwing here would
  // start no MCP server at all on this machine.
  const set = await loadPolicySet(files);
  for (const broken of set.unreadable) {
    warn(
      `${broken.file} would not load, so its rules are not in force: ${broken.issues.length} problem(s)`,
    );
  }
  if (set.policies.length === 0 && set.unreadable.length > 0) {
    // Said out loud, because a machine with rules
    // it cannot read is not ungoverned by choice.
    warn('no rule file loaded, so nothing is being gated here');
    return null;
  }

  return gateOver(set.policies, { environment, serverName, home });
}

export interface GateScene {
  environment: LocalGateEnvironment;
  serverName: string;
  home: string;
  /** The conditions in force as labels, so a freeze or a pause decides the call. */
  stateFacts?: readonly string[];
}

/** One gate over rules already read, as every proxy builds it. */
export function gateOver(policies: readonly Policy[], scene: GateScene): LocalGate {
  const { environment, serverName, home, stateFacts } = scene;
  const allowances = new FileAllowances(home);
  return new LocalGate(policies, {
    agentName: agentServed(environment, serverName),
    allowances: () => allowances.inForceNow(new Date().toISOString()),
    ...(environment.agentRole === undefined ? {} : { agentRole: environment.agentRole }),
    ...(environment.principal === undefined ? {} : { principal: environment.principal }),
    ...(environment.agentName === undefined
      ? {}
      : { parents: parentAgentsOf(process.env, environment.agentName) }),
    ...(stateFacts === undefined ? {} : { stateFacts }),
  });
}

/** The agent a rule's `agents:` and a pause match this server's calls as. */
export function agentServed(
  environment: LocalGateEnvironment,
  serverName: string,
): string {
  return (
    environment.agentName ??
    environment.wrappedFor ??
    `${MCP_ACTION_PREFIX}:${serverName}`
  );
}

export function localGateEnvironment(env: NodeJS.ProcessEnv): LocalGateEnvironment {
  return {
    policies: env[ENV_POLICIES],
    agentName: env[ENV_AGENT_NAME],
    agentRole: named(env[ENV_AGENT_ROLE]),
    principal: named(env[ENV_PRINCIPAL]),
  };
}

/** An empty variable names nobody, so it is absent rather than a person called "". */
function named(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}
