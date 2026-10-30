import type { SkillScope } from '../skills/skill';

/**
 * The Skills Hub as every screen reads and changes it: skills kept once, written into each agent's
 * own format, and held when their folder no longer matches what somebody accepted.
 */

export const SKILLS_METHOD = {
  /** Skills, the agents that take them, and skills found on this machine to import. */
  SKILLS_HUB: 'skills-hub',
  /** Takes a skill found in an agent's folder into the hub, its files with it. */
  SKILL_IMPORT: 'skill-import',
  /** Adds a skill or a new version; one reaching further than the accepted version waits on a signature. */
  SKILL_PUT: 'skill-put',
  /** Gives a skill to an agent, signed, or takes it away, unsigned. */
  SKILL_ASSIGN: 'skill-assign',
  /** Takes a skill out of every agent at once, keeping its assignments for later. */
  SKILL_DISABLE: 'skill-disable',
  /** Hands a disabled skill back to the agents it was given to, as accepted. */
  SKILL_ENABLE: 'skill-enable',
  /** Writes what the hub says into every agent it can write. */
  SKILL_SYNC: 'skill-sync',
  /** Hands out an older accepted version again; signed where it reaches further than the current one. */
  SKILL_ROLLBACK: 'skill-rollback',
  /** Accepts a held skill's folder as it is now; signed where it reaches further. */
  SKILL_ACCEPT: 'skill-accept',
} as const;

/** What one agent keeps of a skill once it is written in that agent's format. */
export interface SkillCompatibility {
  agent: string;
  label: string;
  supported: boolean;
  /** What the agent's format cannot carry, in a sentence each; empty when nothing is lost. */
  loses: string[];
}

export interface SkillVersionView {
  version: string;
  current: boolean;
  /** When somebody accepted it; absent for a version never accepted. */
  acceptedAt?: string;
  digest?: string;
}

/** Why a skill is held: its folder changed since it was accepted, or reaches further than it did. */
export interface SkillHold {
  /** changed, widened, or new for a folder nobody accepted yet. */
  standing: string;
  /** Tools and commands it reaches now that the accepted version did not. */
  gained: string[];
  /** Accepting it needs the person's signature. */
  signed: boolean;
}

export interface SkillAssignmentView {
  agent: string;
  /** A repository it is written into; absent is the home folder. */
  project?: string;
}

export interface SkillPermissionsView {
  filesystem: string[];
  network: string[];
  commands: string[];
}

export interface SkillView {
  name: string;
  scope: SkillScope;
  project?: string;
  category?: string;
  version: string;
  description: string;
  publisher?: string;
  enabled: boolean;
  /** The folder digest as it is now. */
  digest: string;
  /** Present only while it is held, and then nothing new of it is handed out. */
  held?: SkillHold;
  /** Each agent it is given to, once. */
  agents: string[];
  assignments: SkillAssignmentView[];
  compatibility: SkillCompatibility[];
  /** Oldest first. */
  versions: SkillVersionView[];
  updatedAt: string;
  /** Every file beside the instructions, by path. */
  files: string[];
  instructions: string;
  tools: string[];
  mcpServers: string[];
  permissions: SkillPermissionsView;
  dependencies: string[];
  /** Why its folder would not read, when it would not. */
  problems?: string[];
}

/** A skill or persona found in an agent's own folder, offered for import. */
export interface FoundSkillView {
  id: string;
  name: string;
  agent: string;
  /** skill or agent. */
  kind: string;
  path: string;
  tools: string[];
  /** Its grant in words, as `memnox skills` says it. */
  grant: string;
  /** Already in the hub under this name. */
  imported: boolean;
}

/** An agent a skill can be written into, and whether it is installed here. */
export interface SkillAgentView {
  agent: string;
  label: string;
  installed: boolean;
}

export interface SkillsHubView {
  skills: SkillView[];
  found: FoundSkillView[];
  agents: SkillAgentView[];
}

/** What a sync changed, so a screen says it in a line. */
export interface SkillsSyncSummary {
  written: number;
  removed: number;
  files: string[];
  /** Wanted somewhere and not written, with why. */
  skipped: { skill: string; agent: string; path: string; reason: string }[];
}

/** A skill as a form fills it in; every list left out is empty. */
export interface SkillDraft {
  name: string;
  version: string;
  description: string;
  category?: string;
  publisher?: string;
  instructions: string;
  /** Text files beside the instructions, by path inside the skill. */
  files?: { path: string; text: string }[];
  tools?: string[];
  mcpServers?: string[];
  dependencies?: string[];
  agents?: string[];
  permissions?: Partial<SkillPermissionsView>;
}

export interface SkillsRequestFields {
  /** On every change but IMPORT and PUT: the skill, by name. */
  skillName?: string;
  /** On ASSIGN: the agent, by kind. */
  skillAgent?: string;
  /** On ASSIGN: the repository it is written into; on PUT and IMPORT, where a project skill lives. */
  skillProject?: string;
  /** On ASSIGN: given when true, taken away when false. */
  skillOn?: boolean;
  /** On ROLLBACK: the version to hand out again. */
  skillVersion?: string;
  /** On IMPORT: the found skill, by id. */
  skillFoundId?: string;
  /** On PUT and IMPORT: personal or project. */
  skillScope?: SkillScope;
  /** On PUT. */
  skillDraft?: SkillDraft;
}

export interface SkillsResponseFields {
  /** On SKILLS_HUB, and after every change, so a screen redraws from one answer. */
  skillsHub?: SkillsHubView;
  /** On SYNC, and after a change that wrote agents' folders. */
  skillsSynced?: SkillsSyncSummary;
}
