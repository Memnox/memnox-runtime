import type { MemoryScope } from '../projects/project';
import type {
  MemorySourceKind,
  MemorySourceRecord,
  SourceTrust,
} from '../memory-sources/memory-source';
import type {
  MemoryEvidence,
  MemoryItem,
  MemoryKind,
  MemoryOrigin,
  MemoryRule,
  MemoryStatus,
} from './memory-record';

/**
 * The tables of `~/.memnox/memory.db` and the rows they hold, mapped to the domain and back. The
 * keyword index is its own table kept in step by the store, so a search never reads a whole row.
 */

export const MEMORY_DATABASE_FILE = 'memory.db';

export const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL,
  trust TEXT NOT NULL, scope TEXT NOT NULL, project TEXT, secret TEXT, server TEXT, tool TEXT,
  addedAt TEXT NOT NULL, lastReadAt TEXT, lastError TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  sourceId TEXT NOT NULL, document TEXT NOT NULL, stamp TEXT NOT NULL,
  PRIMARY KEY (sourceId, document)
);
CREATE TABLE IF NOT EXISTS passages (
  sourceId TEXT NOT NULL, document TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY (sourceId, document, digest)
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, statement TEXT NOT NULL, subject TEXT NOT NULL,
  status TEXT NOT NULL, scope TEXT NOT NULL, project TEXT, origin TEXT NOT NULL, sourceId TEXT,
  tainted INTEGER NOT NULL, confidence REAL, suggestedBy TEXT, rule TEXT, duplicateOf TEXT,
  proposalId TEXT, createdAt TEXT NOT NULL, decidedAt TEXT, decidedBy TEXT, key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_status ON items (status);
CREATE INDEX IF NOT EXISTS items_key ON items (key);
CREATE TABLE IF NOT EXISTS evidence (
  itemId TEXT NOT NULL, sourceId TEXT NOT NULL, document TEXT NOT NULL, heading TEXT,
  url TEXT, digest TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evidence_item ON evidence (itemId);
CREATE INDEX IF NOT EXISTS evidence_source ON evidence (sourceId);
CREATE TABLE IF NOT EXISTS rejections (key TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item_vectors (
  itemId TEXT NOT NULL, model TEXT NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (itemId, model)
);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED, statement, subject, tokenize = 'porter unicode61'
);
`;

export interface SourceRow {
  id: string;
  kind: string;
  name: string;
  location: string;
  trust: string;
  scope: string;
  project: string | null;
  secret: string | null;
  server: string | null;
  tool: string | null;
  addedAt: string;
  lastReadAt: string | null;
  lastError: string | null;
}

export interface ItemRow {
  id: string;
  kind: string;
  statement: string;
  subject: string;
  status: string;
  scope: string;
  project: string | null;
  origin: string;
  sourceId: string | null;
  tainted: number;
  confidence: number | null;
  suggestedBy: string | null;
  rule: string | null;
  duplicateOf: string | null;
  proposalId: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  key: string;
}

export interface EvidenceRow {
  itemId: string;
  sourceId: string;
  document: string;
  heading: string | null;
  url: string | null;
  digest: string;
  stale: number;
}

/** SQL's NULL as an absent field, which is how the domain says nothing is there. */
function present<K extends string>(
  key: K,
  value: string | null,
): Partial<Record<K, string>> {
  // Cast is safe: a one key object of exactly that key.
  return value === null ? {} : ({ [key]: value } as Record<K, string>);
}

export function sourceOfRow(row: SourceRow): MemorySourceRecord {
  return {
    id: row.id,
    // Cast is safe: only the store writes this table, from a checked record.
    kind: row.kind as MemorySourceKind,
    name: row.name,
    location: row.location,
    trust: row.trust as SourceTrust,
    scope: row.scope as MemoryScope,
    ...present('project', row.project),
    ...present('secret', row.secret),
    ...present('server', row.server),
    ...present('tool', row.tool),
    addedAt: row.addedAt,
    ...present('lastReadAt', row.lastReadAt),
    ...present('lastError', row.lastError),
  };
}

export function sourceToRow(source: MemorySourceRecord): SourceRow {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    location: source.location,
    trust: source.trust,
    scope: source.scope,
    project: source.project ?? null,
    secret: source.secret ?? null,
    server: source.server ?? null,
    tool: source.tool ?? null,
    addedAt: source.addedAt,
    lastReadAt: source.lastReadAt ?? null,
    lastError: source.lastError ?? null,
  };
}

export function evidenceOfRow(row: EvidenceRow): MemoryEvidence {
  return {
    sourceId: row.sourceId,
    document: row.document,
    ...present('heading', row.heading),
    ...present('url', row.url),
    digest: row.digest,
    stale: row.stale === 1,
  };
}

export function itemOfRow(row: ItemRow, evidence: MemoryEvidence[]): MemoryItem {
  return {
    id: row.id,
    // Cast is safe: only the store writes this table, from a checked item.
    kind: row.kind as MemoryKind,
    statement: row.statement,
    subject: row.subject,
    status: row.status as MemoryStatus,
    scope: row.scope as MemoryScope,
    ...present('project', row.project),
    origin: row.origin as MemoryOrigin,
    ...present('sourceId', row.sourceId),
    tainted: row.tainted === 1,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    ...present('suggestedBy', row.suggestedBy),
    // Cast is safe: written by itemToRow from a MemoryRule.
    ...(row.rule === null ? {} : { rule: JSON.parse(row.rule) as MemoryRule }),
    ...present('duplicateOf', row.duplicateOf),
    ...present('proposalId', row.proposalId),
    createdAt: row.createdAt,
    ...present('decidedAt', row.decidedAt),
    ...present('decidedBy', row.decidedBy),
    evidence,
  };
}

export function itemToRow(item: MemoryItem, key: string): ItemRow {
  return {
    id: item.id,
    kind: item.kind,
    statement: item.statement,
    subject: item.subject,
    status: item.status,
    scope: item.scope,
    project: item.project ?? null,
    origin: item.origin,
    sourceId: item.sourceId ?? null,
    tainted: item.tainted ? 1 : 0,
    confidence: item.confidence ?? null,
    suggestedBy: item.suggestedBy ?? null,
    rule: item.rule === undefined ? null : JSON.stringify(item.rule),
    duplicateOf: item.duplicateOf ?? null,
    proposalId: item.proposalId ?? null,
    createdAt: item.createdAt,
    decidedAt: item.decidedAt ?? null,
    decidedBy: item.decidedBy ?? null,
    key,
  };
}

export const SOURCE_COLUMNS = [
  'id',
  'kind',
  'name',
  'location',
  'trust',
  'scope',
  'project',
  'secret',
  'server',
  'tool',
  'addedAt',
  'lastReadAt',
  'lastError',
] as const;

export const ITEM_COLUMNS = [
  'id',
  'kind',
  'statement',
  'subject',
  'status',
  'scope',
  'project',
  'origin',
  'sourceId',
  'tainted',
  'confidence',
  'suggestedBy',
  'rule',
  'duplicateOf',
  'proposalId',
  'createdAt',
  'decidedAt',
  'decidedBy',
  'key',
] as const;
