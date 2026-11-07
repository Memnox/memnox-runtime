import type { ProfileRulePack } from '../daemon/profiles';

/**
 * An agent profile: the job an agent does, kept apart from the harness and the machine it runs
 * on, so two Claude Code sessions can hold two jobs and one job can move to another product.
 */

/** Version 1 files had no job fields; they read as version 2 with none set. */
export const AGENT_PROFILE_VERSION = 2;

/** What a profile computed for a detected agent with nothing bound is called, before its kind. */
export const DEFAULT_PROFILE_PREFIX = 'default-';

export interface AgentProfile {
  version: typeof AGENT_PROFILE_VERSION;
  /** The name made safe for a file, which every method names the profile by too. */
  id: string;
  name: string;
  description?: string;
  /** The job in a sentence, as a person wrote it. */
  purpose?: string;
  /** Matched by a rule's `roles:` when a session runs under this profile and names no role itself. */
  role?: string;
  responsibilities: string[];
  /** Standing words handed to every session under this profile, never a rule. */
  instructions?: string;
  /** Skills Hub skills, by name. */
  skills: string[];
  /** MCP Hub servers, by name. */
  mcpServers: string[];
  rulePack?: ProfileRulePack;
  /** The people who answer for this job, by the names their workspace knows them by. */
  owners: string[];
  /** The operating system user, until a person names an owner. */
  ownerHint?: string;
  /** Projects this job works in, by id or root; empty is not narrowed by project. */
  projects: string[];
  /** The catalog template it was copied from, which grants nothing and is only a label. */
  templateOf?: string;
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
