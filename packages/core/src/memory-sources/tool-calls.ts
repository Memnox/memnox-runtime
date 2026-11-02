import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { DATA_SENSITIVITY } from '../domain/data-classification';
import { redactSecrets } from '../domain/redact';
import { classifyOutgoingData } from '../domain/sensitive-data';
import { SqliteMemoryStore } from '../memory/memory-store';
import { MEMORY_SCOPE } from '../projects/project';
import {
  changedOf,
  MEMORY_SOURCE_KIND,
  trustOf,
  type MemorySource,
  type MemorySourceKind,
  type MemorySourceRecord,
  type SourceDocument,
  type SourceDocumentRef,
  type SourceTrust,
} from './memory-source';

/**
 * What the person's agents read and wrote through a connected app or an MCP server, kept as a memory
 * source on this machine only: one folder per app or server, one file per call, read by the same
 * extractor as their notes. Nothing here is synced, uploaded or shared; the ledger keeps names only.
 */

/** The folder under the Memnox home every agent's calls are kept in, one folder per source. */
export const TOOL_CALLS_DIR = join('memory', 'tool-calls');

/** How a call reached what it called: an app through Memnox Cloud, or an MCP server of the agent's own. */
export const TOOL_CALL_VIA = { APP: 'app', MCP: 'mcp' } as const;
export type ToolCallVia = (typeof TOOL_CALL_VIA)[keyof typeof TOOL_CALL_VIA];

/** Enough of one result to learn from, and small enough that a whole inbox never becomes one passage. */
export const MOST_CALL_CHARS = 6_000;
/** Nested results are walked this deep and no deeper, as the hook reads a result. */
const MOST_DEPTH = 6;
/** Past this many calls a source keeps its newest, so a busy agent cannot fill the disk. */
export const MOST_CALLS_KEPT = 500;

/** One call as it is kept: who made it, through what, and the content, already redacted and capped. */
export interface ToolCallRecord {
  id: string;
  via: ToolCallVia;
  agent: string;
  sessionId?: string;
  /** The app's toolkit slug, for a call through Memnox to a connected app. */
  app?: string;
  /** The MCP server's name, for a call to one. */
  server?: string;
  tool: string;
  /** What it acted on, where the call names one, such as a repository. */
  target?: string;
  at: string;
  text: string;
}

/** What a call came to before it is kept: the raw result, which is redacted and capped here. */
export type ToolCallInput = Omit<ToolCallRecord, 'id' | 'text'> & { result: unknown };

/** Why a call was not kept, so a test and a log can say so. */
export const CALL_SKIPPED = {
  EMPTY: 'empty',
  /** The data rules classed it restricted, so it stays out of memory as it would stay in. */
  RESTRICTED: 'restricted',
  UNNAMED: 'unnamed',
} as const;
export type CallSkipped = (typeof CALL_SKIPPED)[keyof typeof CALL_SKIPPED];

export function toolCallsRootFor(home: string): string {
  return join(home, MEMNOX_HOME, TOOL_CALLS_DIR);
}

/** The one source an app or a server's calls are kept in, the same id every time so calls gather in one. */
export function callSourceIdOf(via: ToolCallVia, name: string): string {
  const digest = createHash('sha256').update(`${via}\n${name}`, 'utf8').digest('hex');
  return `msrc_calls_${digest.slice(0, 16)}`;
}

/** The text of a result: strings as they are, structure as JSON, redacted and cut to the cap. */
export function callContent(result: unknown): string {
  const flat = flatText(result, 0).trim();
  return redactSecrets(flat).slice(0, MOST_CALL_CHARS);
}

function flatText(value: unknown, depth: number): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object' || depth >= MOST_DEPTH) return String(value);
  // MCP answers carry their text in content blocks; anything else is read as JSON.
  const blocks = (value as { content?: unknown }).content;
  if (Array.isArray(blocks)) {
    return blocks.map((each) => flatText(textOf(each), depth + 1)).join('\n');
  }
  try {
    return JSON.stringify(value);
  } catch {
    // A cycle or a value JSON cannot hold is nothing to learn from.
    return '';
  }
}

function textOf(block: unknown): unknown {
  if (typeof block !== 'object' || block === null) return block;
  const text = (block as { text?: unknown }).text;
  return typeof text === 'string' ? text : block;
}

/** The source a call is kept under, created the first time that app or server is called. */
export function callSourceRecord(
  home: string,
  input: Pick<ToolCallRecord, 'via' | 'app' | 'server'>,
  at: string,
): MemorySourceRecord | null {
  const name = input.via === TOOL_CALL_VIA.APP ? input.app : input.server;
  if (name === undefined || name === '') return null;
  const id = callSourceIdOf(input.via, name);
  const kind: MemorySourceKind =
    input.via === TOOL_CALL_VIA.APP
      ? MEMORY_SOURCE_KIND.APP_CALLS
      : MEMORY_SOURCE_KIND.MCP_CALLS;
  return {
    id,
    kind,
    name,
    location: join(toolCallsRootFor(home), id),
    trust: trustOf(kind),
    // The person's own memory on this machine, never a project's, which other people share.
    scope: MEMORY_SCOPE.PERSONAL,
    server: name,
    addedAt: at,
  };
}

/**
 * One call kept: redacted, capped, and skipped where empty or classed restricted. Its source is put in
 * the store first, so a watcher that sees the file finds the source to read.
 */
export async function keepToolCall(
  home: string,
  input: ToolCallInput,
): Promise<{ kept: ToolCallRecord } | { skipped: CallSkipped }> {
  const record = callSourceRecord(home, input, input.at);
  if (record === null || input.tool === '') return { skipped: CALL_SKIPPED.UNNAMED };
  const text = callContent(input.result);
  if (text === '') return { skipped: CALL_SKIPPED.EMPTY };
  // Classed after redaction, so a credential is masked and kept while what the data rules restrict stays out.
  if (classifyOutgoingData(text)?.sensitivity === DATA_SENSITIVITY.RESTRICTED)
    return { skipped: CALL_SKIPPED.RESTRICTED };
  const kept: ToolCallRecord = {
    id: `call_${Date.parse(input.at).toString(36)}_${randomUUID().slice(0, 8)}`,
    via: input.via,
    agent: input.agent,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.app === undefined ? {} : { app: input.app }),
    ...(input.server === undefined ? {} : { server: input.server }),
    tool: input.tool,
    ...(input.target === undefined ? {} : { target: input.target }),
    at: input.at,
    text,
  };
  const store = SqliteMemoryStore.forHome(home);
  try {
    if (store.source(record.id) === null) store.putSource(record);
  } finally {
    store.close();
  }
  await mkdir(record.location, { recursive: true, mode: 0o700 });
  await writeFile(join(record.location, `${kept.id}.json`), JSON.stringify(kept), {
    mode: 0o600,
  });
  return { kept };
}

/** A kept call's id, so a document name never reads a file outside its folder. */
const CALL_ID = /^call_[\w-]+$/;

/** One kept call by its source and id, or null where it is gone, for the views to name who made it. */
export async function readToolCall(
  location: string,
  id: string,
): Promise<ToolCallRecord | null> {
  if (!CALL_ID.test(id)) return null;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(location, `${id}.json`), 'utf8'),
    );
    return isCallRecord(parsed) ? parsed : null;
  } catch {
    // Gone or unreadable: the evidence simply names no call.
    return null;
  }
}

/** The same read for a screen's view, which is drawn synchronously from the store. */
export function readToolCallSync(location: string, id: string): ToolCallRecord | null {
  if (!CALL_ID.test(id)) return null;
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(location, `${id}.json`), 'utf8'),
    );
    return isCallRecord(parsed) ? parsed : null;
  } catch {
    // Gone or unreadable: the evidence simply names no call.
    return null;
  }
}

function isCallRecord(value: unknown): value is ToolCallRecord {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['agent'] === 'string' &&
    typeof row['tool'] === 'string' &&
    typeof row['at'] === 'string' &&
    typeof row['text'] === 'string'
  );
}

/** A folder of kept calls read as a source: each call one document of one passage, by the agent that made it. */
export class ToolCallSource implements MemorySource {
  readonly trust: SourceTrust;

  constructor(
    readonly kind: MemorySourceKind,
    private readonly location: string,
  ) {
    this.trust = trustOf(kind);
  }

  async list(): Promise<SourceDocumentRef[]> {
    const names = await readdir(this.location).catch(() => [] as string[]);
    const ids = names
      .filter((each) => each.endsWith('.json'))
      .map((each) => each.slice(0, -'.json'.length))
      .sort()
      .slice(-MOST_CALLS_KEPT);
    // A kept call never changes, so its id is its stamp.
    return ids.map((id) => ({ document: id, stamp: id }));
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    const call = await readToolCall(this.location, ref.document);
    if (call === null) return null;
    const where = call.app ?? call.server ?? '';
    return {
      document: ref.document,
      passages: [
        {
          document: ref.document,
          heading: `${call.agent} called ${call.tool}${where === '' ? '' : ` on ${where}`}`,
          text: call.text,
          by: call.agent,
        },
      ],
    };
  }

  changedSince(seen: ReadonlyMap<string, string>): Promise<SourceDocumentRef[]> {
    return changedOf(this, seen);
  }
}
