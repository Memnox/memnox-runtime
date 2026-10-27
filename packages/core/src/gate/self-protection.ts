/**
 * Memnox's own rules and state are a person's to change, never an agent's. An agent that
 * could edit its rule file, run `memnox allow` or turn protection off would hold every
 * permission it wanted, so those are refused ahead of every rule, whatever the rules say.
 */
import { ACTION } from '../constants/action.constants';
import type { ActionRequest } from '../domain/action-event';
import { ENV_PARENT_AGENTS } from '../session/agent-lineage';
import { ENV_AGENT_NAME, ENV_AGENT_ROLE, ENV_PRINCIPAL } from './policy-sources';
import { touchesProtected } from './protected-paths';

/** What a refusal here is recorded under, so `why` names it rather than a rule. */
export const SELF_PROTECTION_SIGNAL = 'self-protection';

/** The action a `memnox` command line is recorded under, per subcommand. */
export const MEMNOX_ACTION_PREFIX = 'memnox.';

/**
 * Subcommands that loosen what an agent may do, or answer for a person. Everything else
 * reads (`why`, `report`, `explain`, `status`, `policy test`) or only ever tightens.
 */
const LOOSENING: readonly string[] = [
  'allow',
  'stop',
  'mode',
  'protect',
  'uninstall',
  'resume',
  'approve',
  'approvals',
  'trust',
  'repo',
  'task',
  'config',
  'agents',
  'mcp',
  'budget',
  'policy',
  // A rewind moves a person's files, so it is asked through the session tool, never run from a shell.
  'rewind',
  // Clearing the confirmation key lets the next key to register confirm for the person.
  'voice',
  // A paired device answers held calls, so pairing one, or giving it more, is the person's alone.
  'pair',
  'devices',
  // Signing in as a person lets this terminal answer in their name, which is theirs alone.
  'signin',
  'signout',
  // Revoking what the autopilot granted is the person's call, like the grant it undoes.
  'autopilot',
];

/**
 * Subcommands that read unless one of these flags follows them: `next` then writes an allow
 * rule, and `run` names a job or a person whose authority the agent would then hold.
 */
const LOOSENING_FLAGS: Readonly<Record<string, readonly string[]>> = {
  next: ['--hand-over'],
  run: ['--for', '--role'],
};

/** What the rules know an agent by, set by `memnox run` and never by the agent itself. */
const IDENTITY_VARIABLES: readonly string[] = [
  ENV_AGENT_NAME,
  ENV_AGENT_ROLE,
  ENV_PRINCIPAL,
  ENV_PARENT_AGENTS,
];

/** Reads that share a subcommand with a loosening one. */
const READING: readonly string[] = [
  'policy test',
  'policy check',
  'mode',
  'allow --list',
  'task show',
  'repo list',
  'approvals list',
  'config get',
  'agents list',
  'mcp list',
  'rewind --list',
  'devices list',
  'autopilot --list',
];

/** Subcommands that only read when nothing follows them, and loosen once anything does. */
const BARE_READS: readonly string[] = ['mode', 'voice', 'devices', 'autopilot'];

const WRITES: readonly string[] = [ACTION.FILESYSTEM_WRITE, ACTION.FILESYSTEM_DELETE];

/** A refusal for an agent touching what governs it, or null for anything else. */
export function selfProtection(
  request: ActionRequest,
): { reason: string; signal: string; refuses: true } | null {
  if (WRITES.includes(request.action) && request.target !== undefined) {
    if (!touchesProtected(request.target)) return null;
    return {
      reason: `${request.target} is Memnox's own rules or state, or the settings that install its hooks, which a person changes and an agent never does.`,
      signal: SELF_PROTECTION_SIGNAL,
      refuses: true,
    };
  }
  const forged = request.action === ACTION.SHELL_EXECUTE ? forgedIdentity(request) : null;
  if (forged !== null) {
    return {
      reason: `this sets or clears ${forged}, which is who the rules take this agent to be or to work for, and only "memnox run" started by a person says that.`,
      signal: SELF_PROTECTION_SIGNAL,
      refuses: true,
    };
  }
  if (!request.action.startsWith(MEMNOX_ACTION_PREFIX)) return null;
  const said = request.target ?? request.action.slice(MEMNOX_ACTION_PREFIX.length);
  if (!loosens(said)) return null;
  return {
    reason: `"memnox ${said}" changes what agents may do, which is a person's to run and never an agent's.`,
    signal: SELF_PROTECTION_SIGNAL,
    refuses: true,
  };
}

/** Whether a `memnox` command, from its subcommand on, changes what an agent may do. */
export function loosens(command: string): boolean {
  const words = command.trim().split(/\s+/);
  const subcommand = words[0] ?? '';
  const flags = LOOSENING_FLAGS[subcommand];
  if (flags !== undefined) {
    return words.some((word) =>
      flags.some((flag) => word === flag || word.startsWith(`${flag}=`)),
    );
  }
  if (!LOOSENING.includes(subcommand)) return false;
  const spoken = words.join(' ');
  // `memnox mode` with no mode reads; `memnox mode off` does not. `voice` likewise.
  if (BARE_READS.includes(subcommand) && words.length === 1) return false;
  return !READING.some((read) => read !== 'mode' && spoken.startsWith(read));
}

/** The identity variable a shell line assigns or unsets, read but never changed by an agent. */
function forgedIdentity(request: ActionRequest): string | null {
  const line = request.target ?? '';
  return IDENTITY_VARIABLES.find((name) => identityPattern(name).test(line)) ?? null;
}

function identityPattern(name: string): RegExp {
  // `NAME=x cmd`, `export NAME=x`, `env -u NAME`, `unset NAME`; reading `$NAME` is left alone.
  return new RegExp(
    `(^|[^A-Za-z0-9_$])${name}=|\\bunset\\b[^;&|]*\\b${name}\\b|(-u\\s*|--unset=)${name}\\b`,
  );
}
