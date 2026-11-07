import type { DecisionEffect } from '../constants/decision.constants';
import type { MemoryKind, MemoryOrigin, MemoryStatus } from '../memory/memory-record';
import type {
  MemorySourceKind,
  SkippedDocument,
  SourceTrust,
} from '../memory-sources/memory-source';
import type { MemoryScope } from '../projects/project';
import type { WorkspaceMemory } from '../context/workspace-memory';
import type { WorkspaceGraphView } from '../context/workspace-graph';
import {
  MEMORY_LAYERS_METHOD,
  type MemoryLayersRequestFields,
  type MemoryLayersResponseFields,
} from './memory-layers';
import type { RuleDraftInput } from './policies';

/**
 * Memory as every screen reads and changes it: the sources a person pointed Memnox at, the Learn
 * queue of what was read out of them, and the facts a person confirmed. A model only proposes;
 * a fact is verified by a person's confirm, and a rule holds only once its proposal is signed.
 */

export const MEMORY_METHOD = {
  /** Every source with where it is, its trust, when it was last read and what it taught. */
  MEMORY_SOURCES: 'memory-sources',
  /** Adds a folder, a repository's instruction files, an export, Supermemory or a hub server. */
  MEMORY_SOURCE_ADD: 'memory-source-add',
  /** Takes a source away; what it taught goes outdated rather than vanishing. */
  MEMORY_SOURCE_REMOVE: 'memory-source-remove',
  /** Reads a source again now and extracts what changed, with the person's own agent CLI. */
  MEMORY_SOURCE_READ: 'memory-source-read',
  /** The Learn queue: candidates and conflicts waiting on a person. */
  MEMORY_LEARN: 'memory-learn',
  /** A fact becomes verified; a rule candidate raises a signed rule proposal. */
  MEMORY_CONFIRM: 'memory-confirm',
  /** Rejected, and remembered so the same words are never proposed again. */
  MEMORY_REJECT: 'memory-reject',
  /** A candidate's words or its rule changed before it is confirmed. */
  MEMORY_EDIT: 'memory-edit',
  /** Search over what was learned: keyword, and by meaning too where a local embedding model is turned on. */
  MEMORY_SEARCH: 'memory-search',
  /** What was learned, by status and scope; verified by default. */
  MEMORY_FACTS: 'memory-facts',
  /** Deletes one item and its evidence. */
  MEMORY_FORGET: 'memory-forget',
  /**
   * What the workspace settled and what its connected tools said, as this machine last pulled
   * it, read off disk with no network near it. Only a read down: nothing local goes up with it.
   */
  WORKSPACE_MEMORY: 'workspace-memory',
  /**
   * The workspace's memory graph as the console draws it, read live off the control plane on this
   * machine's own credential and held only in memory, folded with the saved facts. Where the cloud
   * cannot be reached or refuses, the saved facts alone, saying why.
   */
  WORKSPACE_GRAPH: 'workspace-graph',
  ...MEMORY_LAYERS_METHOD,
} as const;

/** A source as a form adds it; a key is named, never sent, and kept with the hub's secrets. */
export interface MemorySourceInput {
  kind: MemorySourceKind;
  /**
   * A folder, absolute, or a repository for instruction files, or an API's base URL. A Markdown,
   * a Notion export or an instructions source may also name one file, which is all it reads.
   */
  location?: string;
  name?: string;
  scope?: MemoryScope;
  /** The OS store entry holding an API key. */
  secret?: string;
  /** For an MCP source: the hub server, and the tool that reads it. */
  server?: string;
  tool?: string;
}

/** How many items a source taught, by where each stands now. */
export interface MemorySourceCounts {
  candidate: number;
  verified: number;
  conflicting: number;
  outdated: number;
  rejected: number;
}

export interface MemorySourceView {
  id: string;
  kind: MemorySourceKind;
  name: string;
  /** The folder, or the API's base URL. */
  location: string;
  trust: SourceTrust;
  scope: MemoryScope;
  project?: string;
  /** Re-read when a file in it changes; false for an API, which is read on request only. */
  watched: boolean;
  /** For a source that needs a key: whether the OS store holds it. Never the value. */
  keyHeld?: boolean;
  lastReadAt?: string;
  /** Why the last read failed, when it did. */
  lastError?: string;
  counts: MemorySourceCounts;
}

export interface MemoryEvidenceView {
  /** As a person reads it: `notes/ops.md#Releases`, or the link. */
  ref: string;
  document: string;
  heading?: string;
  url?: string;
  /** The source's name, or the source id when it was removed. */
  source: string;
  /** The passage changed or went away since it was read. */
  stale: boolean;
  /** For evidence read from an agent's call: who made it, through what, and when, never what it carried. */
  call?: MemoryCallView;
}

/** One call an agent made through an app or an MCP server, named so the map joins the fact to the agent, its conversation and the app. */
export interface MemoryCallView {
  /** `app` for a connected app reached through Memnox, `mcp` for an MCP server. */
  via: string;
  agent: string;
  sessionId?: string;
  /** The app's toolkit slug, on a call through Memnox. */
  app?: string;
  /** The MCP server's name, on a call to one. */
  server?: string;
  tool: string;
  at: string;
}

export interface MemoryRuleView {
  effect: DecisionEffect;
  actions: string[];
  targets?: string[];
  agents?: string[];
  reason: string;
  /** The rule read back in one plain sentence, before any field. */
  sentence: string;
}

export interface MemoryItemView {
  id: string;
  kind: MemoryKind;
  /** Verbatim as it was read or suggested. */
  statement: string;
  subject: string;
  status: MemoryStatus;
  scope: MemoryScope;
  project?: string;
  origin: MemoryOrigin;
  /** Read from a source outside the person's trust. */
  tainted: boolean;
  /** The extractor's own confidence, from 0 to 1, never a person's. */
  extractorConfidence?: number;
  /** The agent that suggested it. */
  suggestedBy?: string;
  rule?: MemoryRuleView;
  /** The earlier item it restates, so the queue says so rather than offering it as news. */
  duplicateOf?: { id: string; statement: string };
  /** The rule proposal waiting on the person's signature. */
  proposalId?: string;
  evidence: MemoryEvidenceView[];
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface MemoryItemsView {
  items: MemoryItemView[];
  /** Matching items past the ones listed, so a cut list never reads as whole. */
  more: number;
}

/** Whether the person's agent CLI read the passages a read found. */
export const EXTRACTOR_STATE = {
  ANSWERED: 'answered',
  /** No agent CLI could be asked, so the new passages wait for the next read. */
  UNAVAILABLE: 'unavailable',
  /** It answered in no shape that could be read. */
  UNREADABLE: 'unreadable',
  /** Nothing new to read. */
  IDLE: 'idle',
} as const;

export type ExtractorState = (typeof EXTRACTOR_STATE)[keyof typeof EXTRACTOR_STATE];

/** What one read came to, so an empty read and a failed one are told apart. */
export interface MemoryReadSummary {
  sourceId: string;
  documents: number;
  passages: number;
  added: number;
  /** Said again by another passage, which only added evidence. */
  merged: number;
  /** Words a person rejected before, not proposed again. */
  rejectedBefore: number;
  /** Citations naming no passage shown, dropped and never repaired. */
  droppedCitations: number;
  /** Candidates that did not survive validation. */
  discarded: number;
  outdated: number;
  /** Whether the person's agent CLI answered, so passages left unread are said as such. */
  extractor: ExtractorState;
  error?: string;
  /** Documents the source holds that this read passed over, and why; absent when none were. */
  skipped?: SkippedDocument[];
}

/** An edit before confirming; a rule goes through the same draft as any other rule. */
export interface MemoryEditInput {
  statement?: string;
  subject?: string;
  rule?: RuleDraftInput;
}

/** How a search was answered, so a screen says keyword only rather than letting it pass as both. */
export const MEMORY_SEARCH_MODE = {
  KEYWORD: 'keyword',
  SEMANTIC: 'semantic',
} as const;

export type MemorySearchMode =
  (typeof MEMORY_SEARCH_MODE)[keyof typeof MEMORY_SEARCH_MODE];

/** A passage a search found in what a source read, so a file's words are found and not only what was learned from it. */
export interface MemoryPassageView {
  sourceId: string;
  document: string;
  heading?: string;
  /** The words around the match, cut short. */
  snippet: string;
}

export interface MemoryRequestFields extends MemoryLayersRequestFields {
  /** On MEMORY_SOURCE_ADD. */
  memorySource?: MemorySourceInput;
  /** On MEMORY_SOURCE_REMOVE and MEMORY_SOURCE_READ. */
  memorySourceId?: string;
  /** On CONFIRM, REJECT, EDIT and FORGET. */
  memoryItemId?: string;
  /** On MEMORY_EDIT. */
  memoryEdit?: MemoryEditInput;
  /** On MEMORY_SEARCH. */
  memoryQuery?: string;
  /** On SEARCH, FACTS and LEARN: personal or project. */
  memoryScope?: MemoryScope;
  /** On MEMORY_FACTS. */
  memoryStatus?: MemoryStatus;
  /** On WORKSPACE_GRAPH: read the cloud again now rather than answer from the last few seconds' read. */
  workspaceGraphFresh?: boolean;
}

export interface MemoryResponseFields extends MemoryLayersResponseFields {
  /** On every source method, so a screen redraws from one answer. */
  memorySources?: MemorySourceView[];
  /** On MEMORY_SOURCE_READ, which waits for a read already running, such as the one an add starts. */
  memoryRead?: MemoryReadSummary;
  /** On LEARN, and after CONFIRM, REJECT and EDIT. */
  memoryLearn?: MemoryItemsView;
  /** On MEMORY_FACTS and MEMORY_SEARCH. */
  memoryFacts?: MemoryItemsView;
  /** On MEMORY_SEARCH: keyword alone, or keyword fused with a local embedding model the person turned on. */
  memorySearchMode?: MemorySearchMode;
  /** On MEMORY_SEARCH: why it was keyword only although semantic search is on, such as the model not answering. */
  memorySearchNote?: string;
  /** On MEMORY_SEARCH: passages of the read documents that matched, best first. */
  memoryPassages?: MemoryPassageView[];
  /** On CONFIRM and EDIT: the item as it now stands. */
  memoryItem?: MemoryItemView;
  /** On WORKSPACE_MEMORY: absent where this machine never pulled one, which is every machine never connected. */
  workspaceMemory?: WorkspaceMemory;
  /** On WORKSPACE_GRAPH: always present, live where the cloud answered and the saved facts where it did not. */
  workspaceGraph?: WorkspaceGraphView;
}
