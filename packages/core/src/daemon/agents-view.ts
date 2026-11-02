import type { DecisionEffect } from '../constants/decision.constants';

/**
 * The agents on this machine as a screen manages them: whether each runs under Memnox, its
 * sessions, its servers from the hub, and what it did today. Names only, never arguments.
 */

export const AGENTS_METHOD = {
  /** Every agent found here, one card each. */
  AGENTS: 'agents',
  /** Holds one agent at once, since that only narrows. */
  AGENT_PAUSE: 'agent-pause',
  /** Lets a paused agent carry on, which waits on the person's signature. */
  AGENT_RESUME: 'agent-resume',
  /** Holds one session before its next action, at once. */
  SESSION_STOP: 'session-stop',
  /** Opens the agent in a new terminal in a folder, for an agent with a known launch command. */
  AGENT_LAUNCH: 'agent-launch',
} as const;

export const AGENT_STATUS = {
  /** Its hook is in, or every server it starts runs through Memnox, so whatever Memnox can see of it is ruled on. */
  PROTECTED: 'protected',
  /** Found here and running outside Memnox. */
  UNPROTECTED: 'unprotected',
  /** Silent for a month and still holding reach. */
  DORMANT: 'dormant',
  /** A person paused it; nothing it asks for runs. */
  PAUSED: 'paused',
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

/** What Memnox holds an agent through, which says what Protect changes for it and when that takes hold. */
export const AGENT_SEAM = {
  /** Its own hook, which every action passes. */
  HOOK: 'hook',
  /**
   * Only the MCP servers it starts, as for Claude Desktop, which has no hook. It reads its config when it
   * opens, so servers put behind Memnox reach it once it is quit and opened again.
   */
  SERVERS: 'servers',
} as const;

export type AgentSeam = (typeof AGENT_SEAM)[keyof typeof AGENT_SEAM];

export interface AgentSessions {
  running: number;
  idle: number;
  finished: number;
}

export interface AgentToday {
  actions: number;
  asked: number;
  refused: number;
}

/** One thing it did lately, by name. */
export interface AgentAction {
  id: string;
  at: string;
  operation: string;
  target?: string;
  effect: DecisionEffect;
}

export interface AgentView {
  kind: string;
  name: string;
  status: AgentStatus;
  /** What Memnox holds it through; absent for an agent it has no way into, which stays unprotected. */
  seam?: AgentSeam;
  /** Where its binary sits: installed, or somewhere unusual. Never the path, which names the user. */
  installed?: string;
  /** Its MCP config file, where the hub found one. */
  configPath?: string;
  /** When a pause lifts on its own. */
  pausedUntil?: string;
  sessions: AgentSessions;
  /** The hub's servers given to it, by name. */
  mcpServers: string[];
  /** The Skills Hub's skills given to it, by name, whether or not they are enabled. */
  skills: string[];
  today: AgentToday;
  /** The last five, newest first. */
  recent: AgentAction[];
  /** Whether AGENT_LAUNCH can open it, which only an agent with a known launch command can. */
  launchable: boolean;
}

/** What AGENT_LAUNCH asked the Mac to type, in the folder it opens on. */
export interface AgentLaunched {
  agent: string;
  workingDirectory: string;
  /** The line typed into the new terminal. */
  line: string;
}

export interface AgentsRequestFields {
  /** On AGENT_PAUSE, AGENT_RESUME and AGENT_LAUNCH: the agent, by kind or by the name it goes by. */
  agentKind?: string;
  /** On AGENT_LAUNCH: the folder it opens in. On EVALUATE: the folder the action runs in, whose project the daemon finds. */
  workingDirectory?: string;
}

export interface AgentsResponseFields {
  /** On AGENTS, and after a pause or a stop. */
  agentsView?: AgentView[];
  /** On AGENT_LAUNCH. */
  agentLaunched?: AgentLaunched;
}
