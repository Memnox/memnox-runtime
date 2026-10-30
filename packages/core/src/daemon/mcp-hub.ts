import type { HubServer, HubTransport } from '../mcp/registry';

/**
 * The MCP Hub as every screen reads and changes it: servers declared once and handed to agents.
 * No method here ever carries a secret's value back, only whether one is held.
 */

export const MCP_HUB_METHOD = {
  /** Servers, agents, and what each agent's config holds that the hub did not write. */
  HUB: 'mcp-hub',
  /** Adds or replaces a server; widening, so it becomes a proposal the person signs. */
  SERVER_PUT: 'mcp-server-put',
  /** Takes a server away from the hub and from every agent it was given to. */
  SERVER_REMOVE: 'mcp-server-remove',
  /** Gives a server to an agent, signed, or takes it away, unsigned. */
  ASSIGN: 'mcp-assign',
  /** Takes a server the person configured themselves into the hub, for that same agent. */
  IMPORT: 'mcp-import',
  /** Writes what the hub says into every agent's config it can write. */
  SYNC: 'mcp-sync',
  /** Asks one server for its tools, on request and never on a timer. */
  TEST: 'mcp-test',
  /** Keeps a credential in the OS store, typed on this machine and never sent from afar. */
  SECRET_SET: 'mcp-secret-set',
  SECRET_REMOVE: 'mcp-secret-remove',
} as const;

export const MCP_HEALTH = {
  UNKNOWN: 'unknown',
  HEALTHY: 'healthy',
  ERROR: 'error',
} as const;

export type McpHealthState = (typeof MCP_HEALTH)[keyof typeof MCP_HEALTH];

/** Whose a server is: the person's own on this machine, or the organization's, which is read only here. */
export const MCP_SCOPE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
} as const;

export type McpScope = (typeof MCP_SCOPE)[keyof typeof MCP_SCOPE];

export interface McpToolSummary {
  name: string;
  description?: string;
}

/** What the last test found, kept until the next one. */
export interface McpServerHealth {
  state: McpHealthState;
  checkedAt?: string;
  error?: string;
  tools?: McpToolSummary[];
}

export interface McpHubServerView {
  name: string;
  /** An organization server is never edited, removed or reassigned on this machine. */
  scope: McpScope;
  description?: string;
  transport: HubTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Plain variables by name only, so a value pasted where a secret belonged is never read back. */
  envNames: string[];
  /** Behind the proxy, so every call is ruled on and recorded. */
  governed: boolean;
  toolCount: number;
  tools?: McpToolSummary[];
  health: McpServerHealth;
  agents: string[];
  /** The agents given it in one repository only, each with that repository, so a screen names the project. */
  projects?: McpProjectAssignment[];
  /** Each secret the server names, and whether the OS store holds it. Never the value. */
  secretsHeld: Record<string, boolean>;
  callsThisWeek: number;
}

/** One agent given a server in one repository, by its absolute path. */
export interface McpProjectAssignment {
  agent: string;
  project: string;
}

/** An agent with an MCP config on this machine, and where it lives. */
export interface McpHubAgentView {
  agent: string;
  path: string;
}

/** One server line in one agent's config that the hub did not write, or that it wrote and a person changed. */
export interface McpHubEntryView {
  agent?: string;
  path: string;
  name: string;
  /** On drifted: edited or removed. On skipped: why it was not written. */
  kind?: string;
  reason?: string;
}

export interface McpHubView {
  servers: McpHubServerView[];
  agents: McpHubAgentView[];
  found: McpHubEntryView[];
  drifted: McpHubEntryView[];
  skipped: McpHubEntryView[];
}

/** What a sync changed, counted per kind, so a screen says it in a line. */
export interface McpSyncSummary {
  added: number;
  updated: number;
  removed: number;
  /** Configs the sync wrote, each backed up first. */
  files: string[];
}

export interface McpHubRequestFields {
  /** On SERVER_PUT: the server as the form filled it, secrets as names only. */
  mcpServer?: HubServer;
  /** On SERVER_REMOVE, ASSIGN, IMPORT and TEST: the server, by name. */
  mcpServerName?: string;
  /** On ASSIGN and IMPORT: the agent, by its kind. */
  mcpAgent?: string;
  /** On ASSIGN: given when true, taken away when false. */
  mcpOn?: boolean;
  /** On SECRET_SET and SECRET_REMOVE: the secret, by name. */
  mcpSecret?: string;
  /** On SECRET_SET: the value, which goes straight to the OS store and is never written anywhere else. */
  mcpSecretValue?: string;
}

export interface McpHubResponseFields {
  /** On HUB, and after every change, so a screen redraws from one answer. */
  mcpHub?: McpHubView;
  /** On TEST: what the server answered. */
  mcpHealth?: McpServerHealth;
  /** On SYNC, and after a change that wrote configs. */
  mcpSynced?: McpSyncSummary;
}
