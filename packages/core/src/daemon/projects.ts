/**
 * Projects as every screen reads and changes them: one repository, the agents seen in it, and
 * the servers, skills, rules and instructions each agent opened there is given.
 */

export const PROJECTS_METHOD = {
  /** Every project on this machine, opened or found, most recently active first. */
  PROJECTS: 'projects',
  /** Takes a folder in as a project and applies it; what widens an agent waits on a signature. */
  PROJECT_OPEN: 'project-open',
  /** Writes a project's `.memnox/project.toml` from a form, applying nothing until asked. */
  PROJECT_PUT: 'project-put',
  /** Hands the project's instructions to its agents at once, and proposes its servers, skills and rules. */
  PROJECT_APPLY: 'project-apply',
} as const;

/** A server or skill the project names, and the agents here that already have it. */
export interface ProjectGrantView {
  name: string;
  /** In the hub on this machine; a name the hub lacks is given to nobody. */
  inHub: boolean;
  /** Of the project's agents, those that have it now. */
  agents: string[];
}

export interface ProjectRulesView {
  /** Relative to the repository, as the manifest names it. */
  file?: string;
  count: number;
  /** In the registry every seam loads. */
  inForce: boolean;
  /** Why the file would not load, when it would not. */
  problem?: string;
}

/** One file an agent reads instructions from: a source the project imports, a file Memnox writes into, or both. */
export interface ProjectInstructionView {
  path: string;
  /** The project reads it as its instructions. */
  source: boolean;
  present: boolean;
  /** The agents that read this file. */
  agents: string[];
  /** Holds a block or file of Memnox's own just now. */
  written: boolean;
}

export interface ProjectMissionView {
  id: string;
  statement: string;
  startedAt: string;
}

export interface ProjectView {
  id: string;
  name: string;
  path: string;
  /** Has a committed `.memnox/project.toml`; otherwise what is shown is found rather than declared. */
  declared: boolean;
  /** Why the committed manifest would not read, when it would not. */
  problems?: string[];
  /** Opened on this machine, which is when its instructions and grants are applied. */
  opened: boolean;
  /** The agents the manifest names, or every agent seen in it when it names none. */
  agents: string[];
  /** Agents that ran a session here, by kind. */
  agentsSeen: string[];
  sessions: { total: number; ended: number };
  servers: ProjectGrantView[];
  skills: ProjectGrantView[];
  rules: ProjectRulesView;
  instructions: ProjectInstructionView[];
  memoryScope: string;
  openMissions: ProjectMissionView[];
  openQuestions: number;
  lastActive?: string;
  appliedAt?: string;
}

export interface ProjectsView {
  projects: ProjectView[];
}

/** What applying did at once, and what it proposed for the person to sign. */
export interface ProjectApplySummary {
  /** Instruction files written or rewritten, relative to the repository. */
  written: string[];
  /** Instruction files of ours taken out, since nothing was left to put in them. */
  removed: string[];
  /** Files a person wrote in the way of one of ours, which were left alone. */
  kept: string[];
  /** The repository's own servers put behind the proxy for Claude Code, which governs and never widens. */
  governed: string[];
  /** Names the manifest gives that the hub on this machine does not have. */
  missing: string[];
}

/** A project as a form fills it in; every list left out is empty. */
export interface ProjectDraft {
  name: string;
  instructions?: string[];
  servers?: string[];
  skills?: string[];
  agents?: string[];
  policy?: string;
  memory?: string;
}

export interface ProjectsRequestFields {
  /** On OPEN: the folder, absolute; on PUT, the repository the manifest is written into. */
  projectPath?: string;
  /** On APPLY. */
  projectId?: string;
  /** On PUT. */
  projectDraft?: ProjectDraft;
}

export interface ProjectsResponseFields {
  /** On PROJECTS, and after every change, so a screen redraws from one answer. */
  projects?: ProjectsView;
  /** On OPEN and APPLY: what was done at once. */
  projectApplied?: ProjectApplySummary;
}
