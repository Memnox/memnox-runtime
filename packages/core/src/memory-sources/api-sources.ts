import { shortDigest } from '../domain/digest';
import { MOST_DOCUMENTS, MOST_FILE_BYTES } from './folder-sources';
import { markdownPassages, MOST_PASSAGE_CHARS } from './markdown';
import {
  changedOf,
  MEMORY_SOURCE_KIND,
  SOURCE_TRUST,
  type MemorySource,
  type SourceDocument,
  type SourceDocumentRef,
} from './memory-source';

/**
 * The sources that are somebody else's service: Supermemory over its HTTP API, and an MCP memory
 * server in the hub. Both are tainted, both are reached only because the person added them, and
 * each read is one bounded page held for the read that follows.
 */

export const SUPERMEMORY_URL = 'https://api.supermemory.ai';
/** One page of the newest documents; a person's own notes are read through a vault instead. */
const MOST_API_DOCUMENTS = 100;
const API_TIMEOUT_MS = 20_000;

/** What a remote source needs from outside, injected so a test reaches no network. */
export interface SupermemoryDeps {
  baseUrl: string;
  /** The key from the OS store, or undefined where it is not held. */
  key: () => Promise<string | undefined>;
  fetch: typeof fetch;
}

interface Held {
  title?: string;
  url?: string;
  text?: string;
}

/** Supermemory's documents, newest first, each split as Markdown is. */
export class SupermemorySource implements MemorySource {
  readonly kind = MEMORY_SOURCE_KIND.SUPERMEMORY;
  readonly trust = SOURCE_TRUST.TAINTED;
  private readonly held = new Map<string, Held>();

  constructor(private readonly deps: SupermemoryDeps) {}

  async list(): Promise<SourceDocumentRef[]> {
    const body = await this.request('/v3/documents/list', {
      method: 'POST',
      body: JSON.stringify({
        limit: MOST_API_DOCUMENTS,
        page: 1,
        sort: 'updatedAt',
        order: 'desc',
      }),
    });
    const found: SourceDocumentRef[] = [];
    for (const each of documentsIn(body).slice(0, MOST_API_DOCUMENTS)) {
      const id = textOf(each['id']);
      if (id === undefined) continue;
      this.held.set(id, heldOf(each));
      found.push({
        document: id,
        stamp: textOf(each['updatedAt']) ?? shortDigest(JSON.stringify(each)),
      });
    }
    return found;
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    let held = this.held.get(ref.document);
    if (held === undefined || held.text === undefined) {
      const body = await this.request(
        `/v3/documents/${encodeURIComponent(ref.document)}`,
        {
          method: 'GET',
        },
      );
      held = { ...held, ...heldOf(isRecord(body) ? body : {}) };
    }
    if (held.text === undefined) return null;
    const url = held.url;
    const passages = markdownPassages(
      ref.document,
      held.text.slice(0, MOST_FILE_BYTES),
      held.title,
    );
    return {
      document: ref.document,
      passages: passages.map((each) => ({
        ...each,
        ...(url === undefined ? {} : { url }),
      })),
    };
  }

  changedSince(seen: ReadonlyMap<string, string>): Promise<SourceDocumentRef[]> {
    return changedOf(this, seen);
  }

  private async request(
    path: string,
    init: { method: string; body?: string },
  ): Promise<unknown> {
    const key = await this.deps.key();
    if (key === undefined)
      throw new Error(
        'The Supermemory key is not held yet. Keep it with the hub secrets first.',
      );
    const response = await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Supermemory answered ${response.status}.`);
    return response.json();
  }
}

/** Calls the memory server's reading tool once; injected so the hub owns starting it. */
export type McpMemoryCall = () => Promise<unknown>;

/** A memory server's answer: a knowledge graph's entities, or else each text it returned. */
export class McpMemorySource implements MemorySource {
  readonly kind = MEMORY_SOURCE_KIND.MCP;
  readonly trust = SOURCE_TRUST.TAINTED;
  private readonly held = new Map<string, string>();

  constructor(private readonly call: McpMemoryCall) {}

  async list(): Promise<SourceDocumentRef[]> {
    this.held.clear();
    for (const [document, text] of entriesOf(await this.call()).slice(0, MOST_DOCUMENTS))
      this.held.set(document, text.slice(0, MOST_FILE_BYTES));
    return [...this.held].map(([document, text]) => ({
      document,
      stamp: shortDigest(text),
    }));
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    const text = this.held.get(ref.document);
    if (text === undefined) return null;
    const passages = markdownPassages(ref.document, text, ref.document);
    return { document: ref.document, passages };
  }

  changedSince(seen: ReadonlyMap<string, string>): Promise<SourceDocumentRef[]> {
    return changedOf(this, seen);
  }
}

/** The text items of an MCP tool result, with a knowledge graph read entity by entity. */
export function entriesOf(result: unknown): [string, string][] {
  const content =
    isRecord(result) && Array.isArray(result['content']) ? result['content'] : [];
  const texts = content
    .filter(isRecord)
    .map((each) => textOf(each['text']))
    .filter((each): each is string => each !== undefined);
  const entries: [string, string][] = [];
  texts.forEach((text, index) => {
    const graph = entitiesIn(text);
    if (graph.length > 0) entries.push(...graph);
    else entries.push([`item ${index + 1}`, text]);
  });
  return entries;
}

/** `read_graph` of the reference memory server answers `{entities: [{name, entityType, observations}]}`. */
function entitiesIn(text: string): [string, string][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain text rather than a graph, which the caller keeps as one item.
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['entities'])) return [];
  return parsed['entities'].filter(isRecord).flatMap((entity): [string, string][] => {
    const name = textOf(entity['name']);
    const observations = Array.isArray(entity['observations'])
      ? entity['observations'].filter((each): each is string => typeof each === 'string')
      : [];
    if (name === undefined || observations.length === 0) return [];
    const kind = textOf(entity['entityType']);
    const said = observations.join('\n').slice(0, MOST_PASSAGE_CHARS);
    return [[name, kind === undefined ? said : `${kind}\n${said}`]];
  });
}

function documentsIn(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body)) return [];
  const list = Array.isArray(body['memories'])
    ? body['memories']
    : Array.isArray(body['documents'])
      ? body['documents']
      : [];
  return list.filter(isRecord);
}

function heldOf(document: Record<string, unknown>): Held {
  const title = textOf(document['title']);
  const url = textOf(document['url']);
  const text = textOf(document['content']) ?? textOf(document['summary']);
  return {
    ...(title === undefined ? {} : { title }),
    ...(url === undefined ? {} : { url }),
    ...(text === undefined ? {} : { text }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
