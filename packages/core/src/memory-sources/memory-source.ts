import type { MemoryScope } from '../projects/project';

/**
 * One port over every place a person keeps what they know: a vault, a folder, agents' instruction
 * files, an export, an API or an MCP memory server. Each is read when the person asks or a file
 * changes, never on a timer, and every read is bounded.
 */

export const MEMORY_SOURCE_KIND = {
  OBSIDIAN: 'obsidian',
  MARKDOWN: 'markdown',
  /** CLAUDE.md, AGENTS.md, GEMINI.md and .cursor/rules in one repository. */
  INSTRUCTIONS: 'instructions',
  NOTION_EXPORT: 'notion-export',
  SUPERMEMORY: 'supermemory',
  /** An MCP memory server in the hub, read through one of its tools. */
  MCP: 'mcp',
  /** What the person's agents read and wrote in one connected app through Memnox, kept on this machine only. */
  APP_CALLS: 'app-calls',
  /** What the person's agents read and wrote through one MCP server, kept on this machine only. */
  MCP_CALLS: 'mcp-calls',
} as const;

export type MemorySourceKind =
  (typeof MEMORY_SOURCE_KIND)[keyof typeof MEMORY_SOURCE_KIND];

export const MEMORY_SOURCE_KINDS: readonly string[] = Object.values(MEMORY_SOURCE_KIND);

/** Files the person points at are their own; anything a third party wrote or exported is not. */
export const SOURCE_TRUST = {
  TRUSTED: 'trusted',
  TAINTED: 'tainted',
} as const;

export type SourceTrust = (typeof SOURCE_TRUST)[keyof typeof SOURCE_TRUST];

/** Third party APIs and exports, tainted whoever added them, as the workspace treats them. */
const ALWAYS_TAINTED: readonly MemorySourceKind[] = [
  MEMORY_SOURCE_KIND.NOTION_EXPORT,
  MEMORY_SOURCE_KIND.SUPERMEMORY,
  MEMORY_SOURCE_KIND.MCP,
  MEMORY_SOURCE_KIND.APP_CALLS,
  MEMORY_SOURCE_KIND.MCP_CALLS,
];

/** Kept by Memnox itself from the calls agents make, so no form adds one and only Memnox writes them. */
export const CALL_SOURCE_KINDS: readonly MemorySourceKind[] = [
  MEMORY_SOURCE_KIND.APP_CALLS,
  MEMORY_SOURCE_KIND.MCP_CALLS,
];

export function isCallSource(kind: string): boolean {
  return (CALL_SOURCE_KINDS as readonly string[]).includes(kind);
}

export function trustOf(kind: MemorySourceKind): SourceTrust {
  return ALWAYS_TAINTED.includes(kind) ? SOURCE_TRUST.TAINTED : SOURCE_TRUST.TRUSTED;
}

/** Whether the source lives on this machine's disk, which is what a file watcher can watch. */
export function isFileSource(kind: MemorySourceKind): boolean {
  return kind !== MEMORY_SOURCE_KIND.SUPERMEMORY && kind !== MEMORY_SOURCE_KIND.MCP;
}

/** A source as the person added it. A key is held in the OS store, and only its name is here. */
export interface MemorySourceRecord {
  id: string;
  kind: MemorySourceKind;
  name: string;
  /** A folder, absolute, or the base URL of an API. */
  location: string;
  trust: SourceTrust;
  scope: MemoryScope;
  /** The repository a project source belongs to. */
  project?: string;
  /** The OS store entry holding the API key. */
  secret?: string;
  /** For an MCP source: the hub server and the tool that reads it. */
  server?: string;
  tool?: string;
  addedAt: string;
  lastReadAt?: string;
  /** Why the last read failed, when it did. */
  lastError?: string;
}

/** One document a source holds, and a stamp that moves when it changes. */
export interface SourceDocumentRef {
  /** A path relative to the source, or the document's id at an API. */
  document: string;
  /** Modified time or version; compared, never parsed. */
  stamp: string;
}

/** A piece of a document under one heading, which is what a citation names. */
export interface SourcePassage {
  document: string;
  heading?: string;
  /** A link to it, where the source has one. */
  url?: string;
  text: string;
  /** The agent whose call brought it in, for a source of agents' calls, so what it teaches is theirs to suggest. */
  by?: string;
}

export interface SourceDocument {
  document: string;
  passages: SourcePassage[];
}

/** The port every source is read through. */
export interface MemorySource {
  readonly kind: MemorySourceKind;
  readonly trust: SourceTrust;
  /** Every document there now, bounded. */
  list(): Promise<SourceDocumentRef[]>;
  /** One document split into passages; null when it is gone or unreadable. */
  read(ref: SourceDocumentRef): Promise<SourceDocument | null>;
  /** Those listed whose stamp moved past the one given, by document. */
  changedSince(seen: ReadonlyMap<string, string>): Promise<SourceDocumentRef[]>;
}

/** The changed half of `list`, shared by every source since a stamp is only ever compared. */
export async function changedOf(
  source: Pick<MemorySource, 'list'>,
  seen: ReadonlyMap<string, string>,
): Promise<SourceDocumentRef[]> {
  const listed = await source.list();
  return listed.filter((each) => seen.get(each.document) !== each.stamp);
}
