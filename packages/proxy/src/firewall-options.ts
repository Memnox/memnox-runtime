import {
  UNNAMED_AGENT,
  type EnforcementMode,
  type EventSink,
  type HoldService,
  type LocalGate,
  type SessionNote,
  type SessionNotes,
  type SharedActions,
  type ToolPins,
  type UnusualNotice,
} from '@memnox/core';

import type { GateSource } from './live-gate';
import type { ProbationLookup } from './probation-authorizer';
import type { SessionLimits } from './session-limits';
import type { ToolCall } from './tool-call';

/**
 * What the firewall is wired with: the server it stands in front of, the rules it reads, and
 * where its rows, questions and notes go. Built by `cli.ts`, so a test hands in only what it needs.
 */

/** A streamable HTTP server: where it answers, and the headers every request carries, secrets already resolved. */
export interface RemoteServer {
  url: string;
  headers: Record<string, string>;
}

export interface FirewallOptions {
  /** The wrapped MCP server, e.g. ["npx", "-y", "@some/mcp-server"]; empty for a remote one. */
  command: string[];
  /** Set for a server reached over HTTP, which is then never spawned. */
  remote?: RemoteServer;
  serverName: string;
  allowPattern?: string;
  denyPattern?: string;
  /** Groups this proxy's calls in the audit timeline. */
  sessionId?: string;
  /** The project of the folder the proxy runs in, so a rule scoped to that project decides. */
  projectId?: string;
  /** That folder, so a rule held to a repository's folders decides its calls as a hook's. */
  workingDirectory?: string;
  /** Loading is the caller's job because it reads files; see loadLocalGate. */
  gate?: LocalGate;
  /** Read again on every call, so a pause or a pulled bundle bites at once; wins over `gate`. */
  gates?: GateSource;
  /** The wrapped server's environment, which may name the database it reaches. */
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** The MCP client this wraps, for the row. Never a credential. */
  agent?: string;
  /**
   * Where rows go, opened by the caller; absent means
   * no recording, so a test writes to no ledger.
   */
  ledger?: EventSink;
  /** Supplied so a row's time is the caller's to fix in a test. */
  now?: () => Date;
  /**
   * The pause and the budget. Absent means neither
   * is consulted, so nothing here reads a disk.
   */
  limits?: SessionLimits;
  /** True while `memnox stop` holds. Absent means never, so a test reads no disk. */
  stopped?: () => Promise<boolean>;
  /**
   * Holds an ASK for a person. Absent means an ASK
   * is a denial and says so, right for a test only.
   */
  hold?: HoldService;
  /**
   * The workspace's register of what other agents
   * are about to do. Absent means nothing is asked.
   */
  actions?: SharedActions;
  /** The workspace's inbox for this agent. Absent means nothing is collected. */
  notes?: SessionNotes;
  /** Whether this server is still on probation. Absent means it never is. */
  probation?: ProbationLookup;
  /** Where an instruction-shaped result puts the session under suspicion. Absent, nowhere. */
  notice?: UnusualNotice;
  /** What this server listed last time. Absent means no listing is compared. */
  pins?: ToolPins;
  /** The machine's mode, for the row a new tool is recorded under. */
  mode?: EnforcementMode;
}

/**
 * The session a claim is filed under when the agent named
 * none: one per proxy, as agents start servers per session.
 */
export function unnamedSession(): string {
  return `ses_proxy_${process.pid}`;
}

/**
 * What this proxy collects notes as: the same
 * agent and session its claims are filed under.
 */
export function notesFor(options: FirewallOptions): {
  notes?: () => Promise<SessionNote[]>;
} {
  const inbox = options.notes;
  if (inbox === undefined) return {};
  const agent = options.agent ?? UNNAMED_AGENT;
  const session = options.sessionId ?? unnamedSession();
  return { notes: () => inbox.collect(agent, session) };
}

/**
 * The server and tool whose result read like instructions, named so every
 * seam in the session can say which result it is still wary of.
 */
export function taintFor(options: FirewallOptions): {
  onInstruction?: (call: ToolCall) => void;
} {
  const notice = options.notice;
  if (notice === undefined) return {};
  return {
    onInstruction: (call) => {
      notice.taint(`${options.serverName}.${call.name}`);
    },
  };
}
