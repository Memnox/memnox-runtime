/**
 * What the Memnox entry says, in whichever format the agent keeps its config. One name,
 * so onboarding twice replaces its own entry and offboarding removes exactly its own.
 */
import { WORKSPACE_SERVER_NAME } from '@memnox/core';

export const MANAGED_SERVER = WORKSPACE_SERVER_NAME;

/** What the entry claims, so a person reading their own config knows why it is there. */
export interface ManagedServer {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

export function managedServerFor(mcpUrl: string, token: string): ManagedServer {
  return {
    type: 'http',
    url: mcpUrl,
    // The machine credential this agent was enrolled under, which reaches its own workspace only.
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * The same server for an agent whose config starts only a command, such as Claude Desktop, which skips an entry
 * naming a URL as not a server at all. The credential rides in its environment, where no process listing shows it.
 */
export interface ManagedBridge {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Either shape; only JSON configs are ever given the command, since only Claude Desktop needs it. */
export type ManagedEntry = ManagedServer | ManagedBridge;

/** How the bridge is started: the node running this memnox and the script beside it, so no PATH is needed. */
export interface BridgeLaunch {
  command: string;
  args: string[];
}

export function managedBridgeFor(
  mcpUrl: string,
  token: string,
  launch: BridgeLaunch,
  authorizationEnv: string,
): ManagedBridge {
  return {
    command: launch.command,
    args: [...launch.args, mcpUrl],
    env: { [authorizationEnv]: `Bearer ${token}` },
  };
}

export interface RewriteResult {
  /** The config as it should now be written, or null where it cannot be. */
  next: string | null;
  /** Why, where it cannot. Said to the person rather than swallowed. */
  because?: string;
}

export const CONFIG_FORMAT = {
  JSON: 'json',
  TOML: 'toml',
  YAML: 'yaml',
} as const;

export type ConfigFormat = (typeof CONFIG_FORMAT)[keyof typeof CONFIG_FORMAT];

/** Which format a config file is, by extension, because that is what its agent goes by. */
export function configFormatOf(path: string): ConfigFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return CONFIG_FORMAT.JSON;
  if (lower.endsWith('.toml')) return CONFIG_FORMAT.TOML;
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return CONFIG_FORMAT.YAML;
  return null;
}
