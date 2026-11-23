import type { ProfileRulePack } from '../daemon/profiles';

/**
 * An agent profile: who an agent is to Memnox, kept apart from the harness and the machine it runs
 * on, with who answers for it, the role rules match and what it is given.
 */

/** Version 1 files had no role or responsible person; they read as version 2 with none set. */
export const AGENT_PROFILE_VERSION = 2;

/** What a profile computed for a detected agent with nothing bound is called, before its kind. */
export const DEFAULT_PROFILE_PREFIX = 'default-';

export interface AgentProfile {
  version: typeof AGENT_PROFILE_VERSION;
  /** The name made safe for a file, which every method names the profile by too. */
  id: string;
  name: string;
  description?: string;
  /** Matched by a rule's `roles:` when a session runs under this profile and names no role itself. */
  role?: string;
  /** Skills Hub skills, by name. */
  skills: string[];
  /** MCP Hub servers, by name. */
  mcpServers: string[];
  rulePack?: ProfileRulePack;
  /**
   * The one person who answers for this agent: the signed in account, else the person at this
   * machine. Asks go to them; the agent never holds their authority, and the gate never reads it.
   */
  responsiblePerson?: string;
  /** Projects it works in, by id or root; empty is not narrowed by project. */
  projects: string[];
  updatedAt: string;
}

/** The profile id a detected agent of this kind answers to while nobody has bound it. */
export function defaultProfileIdFor(kind: string): string {
  return `${DEFAULT_PROFILE_PREFIX}${kind}`;
}

export function isDefaultProfileId(id: string): boolean {
  return id.startsWith(DEFAULT_PROFILE_PREFIX);
}

/** Where a session's role came from, strongest first. */
export interface RoleSources {
  /** `--role` on the command line. */
  flag?: string;
  /** `MEMNOX_AGENT_ROLE` inherited from the environment. */
  inherited?: string;
  /** The role of the profile bound to the agent this session runs. */
  profile?: string;
}

/** The role a session is matched under: what a person typed wins, and a profile only fills a gap. */
export function sessionRoleOf(sources: RoleSources): string | undefined {
  return [sources.flag, sources.inherited, sources.profile]
    .map((each) => each?.trim())
    .find((each): each is string => each !== undefined && each !== '');
}
