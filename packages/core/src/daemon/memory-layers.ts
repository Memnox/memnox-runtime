/**
 * Long and short term memory as layers any agent reads: MEMORY.md for every chat, the router file
 * that points each department at its own file, and the skills that say where live data is. A plan
 * is only a preview; it is written inside Memnox's fenced blocks once the person confirms that plan.
 */

export const MEMORY_LAYERS_METHOD = {
  /** Each project's three layers as they stand: MEMORY.md, the router files, and the SKILL.md skills. */
  MEMORY_LAYERS: 'memory-layers',
  /** The proposed MEMORY.md index and router lines for one project, a preview that writes nothing. */
  MEMORY_LAYERS_PLAN: 'memory-layers-plan',
  /** Writes the plan the person confirmed, refused when the files changed since it was shown. */
  MEMORY_LAYERS_APPLY: 'memory-layers-apply',
  /** The last thirty days of chats: how often a cold cache was loaded again, and what keeping it warm saves. */
  SESSION_COST: 'session-cost',
} as const;

/** Which of the three layers a file is. */
export const MEMORY_LAYER = {
  /** MEMORY.md, read in every chat: one line per memory, each linked to its file. */
  INDEX: 'index',
  /** CLAUDE.md, AGENTS.md, GEMINI.md or Cursor's rules: one line per department. */
  ROUTER: 'router',
  /** One memory written as its own file, which the index links to. */
  MEMORY: 'memory',
} as const;

export type MemoryLayer = (typeof MEMORY_LAYER)[keyof typeof MEMORY_LAYER];

/** MEMORY.md as it stands: whether it is there, how long, and how many of its lines link nowhere. */
export interface MemoryIndexLayerView {
  /** Relative to the repository. */
  path: string;
  present: boolean;
  lines: number;
  /** Lines that say something and link to no file, which is what the index is meant to avoid. */
  unlinked: number;
}

/** One agent's router file as it stands. */
export interface MemoryRouterLayerView {
  agent: string;
  /** Relative to the repository. */
  path: string;
  present: boolean;
  lines: number;
  chars: number;
  /** Folders of the repository that keep their own instruction file, each a department. */
  departments: string[];
  /** Of those, how many the router names. */
  routed: number;
}

/** A SKILL.md the project's agents read, and whether it says where live data is. */
export interface MemorySkillLayerView {
  name: string;
  /** Relative to the repository. */
  path: string;
  /** It names a database, a table, a query or an address to read live data from. */
  liveData: boolean;
}

export interface ProjectLayersView {
  name: string;
  /** The repository, absolute. */
  path: string;
  agents: string[];
  index: MemoryIndexLayerView;
  routers: MemoryRouterLayerView[];
  skills: MemorySkillLayerView[];
  /** What the router's block keeps when a chat compacts, as last written. */
  keep: string[];
}

/** What memory measured about itself; every field is absent where nothing was measured. */
export interface MemoryValueView {
  /** The median of the recent searches on this machine, in milliseconds. */
  searchMedianMs?: number;
  /** How many searches that median is over. */
  searches?: number;
  /** Tokens agents did not read because a memory read answered in budgeted lines rather than whole, where measured. */
  contextTokensSaved?: number;
}

export interface MemoryLayersView {
  projects: ProjectLayersView[];
  value: MemoryValueView;
}

/** One file a plan writes: its block before and after, by line, so a screen draws the change. */
export interface MemoryLayerFilePlan {
  /** Relative to the repository. */
  path: string;
  layer: MemoryLayer;
  /** The agent that reads it, on a router file. */
  agent?: string;
  /** A whole file of ours rather than a block inside a person's. */
  whole: boolean;
  before: string[];
  after: string[];
  changed: boolean;
}

export interface MemoryLayersPlan {
  /** The repository, absolute. */
  project: string;
  /** What the person confirms; apply refuses a plan whose digest no longer matches. */
  digest: string;
  files: MemoryLayerFilePlan[];
}

export interface MemoryLayersApplied {
  written: string[];
  unchanged: string[];
}

/** One model's API prices in US dollars per million tokens. */
export interface ModelPriceView {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
}

/** The last days of chats, read from the transcripts the runtime already reads; never a ping. */
export interface SessionCostView {
  days: number;
  sessions: number;
  turns: number;
  /** Turns that loaded their whole context into the cache again after it went cold. */
  coldReloads: number;
  reloadedTokens: number;
  /** What those reloads cost at API prices; absent where a model's price is unknown. */
  reloadCostUsd?: number;
  /** What keeping each chat warm for the window would have saved, net of keeping it warm; absent likewise. */
  warmSavingUsd?: number;
  /** How long a chat would be kept warm, in hours. */
  warmHours: number;
  /** Models seen whose price is not in the table, so the totals say what they leave out. */
  unpricedModels: string[];
  prices: ModelPriceView[];
}

export interface MemoryLayersRequestFields {
  /** On PLAN and APPLY, and to narrow MEMORY_LAYERS: the repository, absolute. */
  memoryLayersProject?: string;
  /** On PLAN and APPLY: one agent's router; absent is every agent of the project. */
  memoryLayersAgent?: string;
  /** On PLAN and APPLY: what the router keeps when a chat compacts, one line each. */
  memoryKeep?: string[];
  /** On APPLY: the digest of the plan the person confirmed. */
  memoryLayersDigest?: string;
}

export interface MemoryLayersResponseFields {
  /** On MEMORY_LAYERS, and after APPLY. */
  memoryLayers?: MemoryLayersView;
  /** On PLAN. */
  memoryLayersPlan?: MemoryLayersPlan;
  /** On APPLY. */
  memoryLayersApplied?: MemoryLayersApplied;
  /** On SESSION_COST. */
  sessionCost?: SessionCostView;
}
