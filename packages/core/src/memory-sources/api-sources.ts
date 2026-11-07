import { HTTP_METHOD } from '../constants/action.constants';
import { shortDigest } from '../domain/digest';
import { HTTP, isCredentialRefused } from '../sync/http-status';
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
 * every list is bounded however much the other side holds.
 */

export const SUPERMEMORY_URL = 'https://api.supermemory.ai';
// https://supermemory.ai/docs/api-reference/documents/list-documents
const SUPERMEMORY_LIST_PATH = '/v3/documents/list';
// https://supermemory.ai/docs/api-reference/documents/get-document
const SUPERMEMORY_DOCUMENT_PATH = '/v3/documents/';
/** One page of a list; the request schema sets no maximum, so the bound is this one. */
const API_PAGE_SIZE = 100;
/** Enough pages to reach the most a source lists, and never more however many the API reports. */
const MOST_API_PAGES = Math.ceil(MOST_DOCUMENTS / API_PAGE_SIZE);
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
}

/** A 404 on one document, which the port reads as gone rather than as a failure. */
const GONE = Symbol('gone');

/** Supermemory's documents, newest first, each read whole and split as Markdown is. */
export class SupermemorySource implements MemorySource {
  readonly kind = MEMORY_SOURCE_KIND.SUPERMEMORY;
  readonly trust = SOURCE_TRUST.TAINTED;
  private readonly held = new Map<string, Held>();

  constructor(private readonly deps: SupermemoryDeps) {}

  async list(): Promise<SourceDocumentRef[]> {
    this.held.clear();
    const found = new Map<string, SourceDocumentRef>();
    for (let page = 1; page <= MOST_API_PAGES; page += 1) {
      const listed = listedPage(
        await this.request(SUPERMEMORY_LIST_PATH, listBody(page)),
      );
      for (const each of listed.documents) {
        const id = textOf(each['id']);
        if (id === undefined || found.size >= MOST_DOCUMENTS) continue;
        this.held.set(id, heldOf(each));
        found.set(id, { document: id, stamp: stampOf(each) });
      }
      if (page >= listed.totalPages || found.size >= MOST_DOCUMENTS) break;
    }
    return [...found.values()];
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    const body = await this.request(
      `${SUPERMEMORY_DOCUMENT_PATH}${encodeURIComponent(ref.document)}`,
      { method: HTTP_METHOD.GET },
    );
    if (body === GONE || !isRecord(body)) return null;
    // A list omits content unless asked, and before extraction finishes a summary is all there is.
    const text = textOf(body['content']) ?? textOf(body['summary']);
    if (text === undefined) return null;
    const held = { ...this.held.get(ref.document), ...heldOf(body) };
    const url = held.url;
    const passages = markdownPassages(
      ref.document,
      text.slice(0, MOST_FILE_BYTES),
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
    if (response.status === HTTP.NOT_FOUND && init.method === HTTP_METHOD.GET)
      return GONE;
    if (!response.ok) throw new Error(refusalOf(response.status));
    try {
      return await response.json();
    } catch (error) {
      throw new Error('Supermemory answered with something that is not JSON.', {
        cause: error,
      });
    }
  }
}

function listBody(page: number): { method: string; body: string } {
  return {
    method: HTTP_METHOD.POST,
    body: JSON.stringify({
      limit: API_PAGE_SIZE,
      page,
      sort: 'updatedAt',
      order: 'desc',
    }),
  };
}

/** The sentence a refusal is shown as; the body is the third party's text, so it is not echoed. */
function refusalOf(status: number): string {
  if (isCredentialRefused(status))
    return 'Supermemory refused the key. Keep a current one with the hub secrets.';
  if (status === HTTP.TOO_MANY_REQUESTS)
    return 'Supermemory is limiting how often this key may read, so read it again later.';
  return `Supermemory answered ${status}.`;
}

/** `{memories, pagination}` as documented; any other shape fails closed rather than reading as empty. */
function listedPage(body: unknown): {
  documents: Record<string, unknown>[];
  totalPages: number;
} {
  const pagination = isRecord(body) ? body['pagination'] : undefined;
  const totalPages = isRecord(pagination) ? pagination['totalPages'] : undefined;
  if (
    !isRecord(body) ||
    !Array.isArray(body['memories']) ||
    typeof totalPages !== 'number'
  )
    throw new Error(
      'Supermemory answered a document list in a shape this reader does not know, so nothing was read.',
    );
  return { documents: body['memories'].filter(isRecord), totalPages };
}

/** The status joins the time, so a document listed mid extraction is read again once it is done. */
function stampOf(document: Record<string, unknown>): string {
  const updated = textOf(document['updatedAt']);
  if (updated === undefined) return shortDigest(JSON.stringify(document));
  const status = textOf(document['status']);
  return status === undefined ? updated : `${updated} ${status}`;
}

function heldOf(document: Record<string, unknown>): Held {
  const title = textOf(document['title']);
  const url = textOf(document['url']);
  return {
    ...(title === undefined ? {} : { title }),
    ...(url === undefined ? {} : { url }),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
