import { delimiter, join } from 'node:path';
import { DISCOVERED_AGENT_KIND, type DiscoveredAgentKind } from './discovery.constants';
import type { MachineReader } from './ports';

/**
 * The binary an agent runs as, found the way the shell finds it: the first match on PATH.
 * Where it lives is read off the path; who signed it needs an inspector, because that
 * means running the platform's own tool, and discovery reads files and runs nothing.
 */
export const HOST_SIGNATURE = {
  /** Signed by a named developer identity. */
  SIGNED: 'signed',
  /** Signed with no identity, which is how a locally built binary is signed. */
  AD_HOC: 'ad-hoc',
  UNSIGNED: 'unsigned',
  /** A script for an interpreter, which no platform signs. */
  SCRIPT: 'script',
  /** Not checked, or not checkable on this platform. */
  UNKNOWN: 'unknown',
} as const;

export type HostSignatureState = (typeof HOST_SIGNATURE)[keyof typeof HOST_SIGNATURE];

export const HOST_LOCATION = {
  /** Somewhere a package manager or an installer puts binaries. */
  INSTALLED: 'installed',
  /** Temp, Downloads, or inside the work: places a binary lands without being installed. */
  UNUSUAL: 'unusual',
} as const;

export type HostLocation = (typeof HOST_LOCATION)[keyof typeof HOST_LOCATION];

export interface HostSignature {
  state: HostSignatureState;
  /** The identity it was signed with, as the platform printed it. */
  signer?: string;
}

export interface AgentHost {
  /** The path on PATH, which is what a shell would run. */
  path: string;
  location: HostLocation;
  signature: HostSignature;
}

/** Reads a binary's signature. Absent, every host reports its signature as unknown. */
export interface HostInspector {
  inspect(path: string): Promise<HostSignature>;
}

/** The command each product installs. One kind may ship more than one name. */
const HOST_COMMANDS: Partial<Record<DiscoveredAgentKind, readonly string[]>> = {
  [DISCOVERED_AGENT_KIND.CLAUDE_CODE]: ['claude'],
  [DISCOVERED_AGENT_KIND.CODEX_CLI]: ['codex'],
  [DISCOVERED_AGENT_KIND.CURSOR]: ['cursor-agent', 'cursor'],
  [DISCOVERED_AGENT_KIND.HERMES]: ['hermes'],
  [DISCOVERED_AGENT_KIND.OPENCLAW]: ['openclaw'],
  [DISCOVERED_AGENT_KIND.RUFLO]: ['ruflo', 'claude-flow'],
};

/** Places no installer writes to: absolute prefixes, then directories under the home. */
const UNUSUAL_SYSTEM_PREFIXES: readonly string[] = [
  '/tmp/',
  '/private/tmp/',
  '/var/folders/',
];
const UNUSUAL_HOME_DIRS: readonly string[] = ['Downloads', 'Desktop'];

export interface HostSearch {
  /** The PATH the agent would be started with, split by the platform's delimiter. */
  path: string | undefined;
  projectDirs: readonly string[];
  inspector?: HostInspector;
}

/** The first match on PATH, or null when the product installs no command or none is found. */
export async function agentHostOf(
  kind: DiscoveredAgentKind,
  reader: MachineReader,
  search: HostSearch,
): Promise<AgentHost | null> {
  const commands = HOST_COMMANDS[kind];
  if (commands === undefined || search.path === undefined) return null;
  const dirs = search.path.split(delimiter).filter((dir) => dir !== '');
  for (const dir of dirs) {
    for (const command of commands) {
      const path = join(dir, command);
      if (!(await reader.exists(path))) continue;
      return {
        path,
        location: locationOf(path, reader.homeDir(), search.projectDirs),
        signature:
          search.inspector === undefined
            ? { state: HOST_SIGNATURE.UNKNOWN }
            : await search.inspector.inspect(path),
      };
    }
  }
  return null;
}

/**
 * A directory on PATH inside the repository is the classic plant: the agent's own name,
 * resolved ahead of the installed one, from a place a clone can write.
 */
export function locationOf(
  path: string,
  home: string,
  projectDirs: readonly string[],
): HostLocation {
  const unusual =
    UNUSUAL_SYSTEM_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    UNUSUAL_HOME_DIRS.some((dir) => path.startsWith(`${join(home, dir)}/`)) ||
    projectDirs.some((dir) => path.startsWith(`${dir}/`));
  return unusual ? HOST_LOCATION.UNUSUAL : HOST_LOCATION.INSTALLED;
}
