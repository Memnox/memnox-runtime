import type { AgentConnection } from '../agents/agent-connection';

/**
 * Profiles as every screen reads and applies them: one named bundle of Skills Hub skills, MCP Hub
 * servers and a rule pack, such as Backend Engineering, kept under the Memnox home. Applying one
 * to an agent and a project raises the signed proposals each piece raises on its own.
 */

export const PROFILES_METHOD = {
  /** Every profile kept here, with what of each the hubs no longer hold. */
  PROFILES: 'profiles',
  /** Adds a profile or replaces one of the same name; it grants nothing until it is applied. */
  PROFILE_PUT: 'profile-put',
  /** Forgets a profile; what it already handed out stays where it was given. */
  PROFILE_REMOVE: 'profile-remove',
  /** Proposes giving an agent the profile's servers and skills, in a project, and its rule pack's rules. */
  PROFILE_APPLY: 'profile-apply',
  /** Binds a kept profile to one agent found here; its ledger key stays `agt_<kind>`. */
  PROFILE_BIND: 'profile-bind',
  /** Takes a binding off, which puts the agent back on its default profile. */
  PROFILE_UNBIND: 'profile-unbind',
} as const;

/** A rule pack as a profile carries it: its name and its TOML, imported as any pack is. */
export interface ProfileRulePack {
  name: string;
  toml: string;
}

/** A profile as a form fills it in. */
export interface ProfileDraft {
  name: string;
  description?: string;
  /** Skills Hub skills, by name. */
  skills?: string[];
  /** MCP Hub servers, by name. */
  mcpServers?: string[];
  rulePack?: ProfileRulePack;
  /** The job, each field optional so a version 1 form still fills a profile in. */
  purpose?: string;
  role?: string;
  responsibilities?: string[];
  instructions?: string;
  responsiblePerson?: string;
  projects?: string[];
  templateOf?: string;
}

/** The job fields a profile shows beside what it bundles. */
export interface ProfileJob {
  purpose?: string;
  role?: string;
  responsibilities: string[];
  instructions?: string;
  /** Who answers for it; on a view, the person at this machine when none was named. */
  responsiblePerson?: string;
  projects: string[];
  templateOf?: string;
}

export interface ProfileView extends ProfileJob {
  /** The name made safe for a file, which every method names the profile by too. */
  id: string;
  name: string;
  description?: string;
  skills: string[];
  mcpServers: string[];
  /** The pack's name and how many rules it holds, never its text. */
  rulePack?: { name: string; rules: number };
  updatedAt: string;
  /** Names the hubs no longer hold, or a pack that no longer loads, each in a sentence. */
  missing: string[];
  /** The agent's own default, computed for an agent nobody bound and never stored. */
  isDefault?: true;
  /** How it reaches the agents it works through; empty is a profile with no agent behind it. */
  connections: AgentConnection[];
}

/** What applying a profile raised, so a screen says it in a line and opens the cards. */
export interface ProfileApplied {
  profile: string;
  agent: string;
  project?: string;
  /** Proposal ids, one per server, skill and rule, each signed on its own. */
  proposed: string[];
  /** Already given to that agent, so nothing was raised for them. */
  already: string[];
  /** Not raised, each with why. */
  skipped: string[];
}

export interface ProfilesRequestFields {
  /** On PROFILE_PUT. */
  profileDraft?: ProfileDraft;
  /** On PROFILE_REMOVE, PROFILE_APPLY, PROFILE_BIND and AGENT_LAUNCH: the profile, by id or by name. */
  profileName?: string;
  /** On PROFILE_APPLY: the agent, by kind. */
  profileAgent?: string;
  /** On PROFILE_BIND and PROFILE_UNBIND: the agent, by id, kind or the name it goes by. */
  agentId?: string;
  /** On PROFILE_APPLY: the repository its skills are written into and its rules hold in, as an absolute path; absent is the home folder and the whole machine. */
  profileProject?: string;
}

export interface ProfilesResponseFields {
  /** On every profile method, so a screen redraws from one answer. */
  profiles?: ProfileView[];
  /** On PROFILE_APPLY, and on AGENT_LAUNCH with a profile. */
  profileApplied?: ProfileApplied;
}
