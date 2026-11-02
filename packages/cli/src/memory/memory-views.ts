import {
  evidenceRef,
  isCallSource,
  isFileSource,
  MEMORY_SOURCE_KIND,
  readToolCallSync,
  sentenceOfRule,
  type MemoryCallView,
  type MemoryEvidence,
  type MemoryItem,
  type MemoryItemView,
  type MemoryItemsView,
  type MemorySourceRecord,
  type MemorySourceView,
  type MemoryStatus,
  type SecretStore,
  type SqliteMemoryStore,
} from '@memnox/core';
import { learnedPolicy } from './learned-rule';

/**
 * Memory as a screen draws it: each item verbatim with its evidence, its rule read back as a
 * sentence, the extractor's confidence labelled as the extractor's, and what it restates; each
 * source with its counts and whether its key is held, never the key.
 */

export function itemsView(
  store: SqliteMemoryStore,
  items: readonly MemoryItem[],
  total: number,
): MemoryItemsView {
  const sources = new Map(store.sources().map((each) => [each.id, each]));
  return {
    items: items.map((item) => itemView(store, item, sources)),
    more: Math.max(0, total - items.length),
  };
}

export function itemView(
  store: SqliteMemoryStore,
  item: MemoryItem,
  sources: ReadonlyMap<string, MemorySourceRecord> = sourcesOf(store),
): MemoryItemView {
  const restated = item.duplicateOf === undefined ? null : store.item(item.duplicateOf);
  return {
    id: item.id,
    kind: item.kind,
    statement: item.statement,
    subject: item.subject,
    status: item.status,
    scope: item.scope,
    ...(item.project === undefined ? {} : { project: item.project }),
    origin: item.origin,
    tainted: item.tainted,
    ...(item.confidence === undefined ? {} : { extractorConfidence: item.confidence }),
    ...(item.suggestedBy === undefined ? {} : { suggestedBy: item.suggestedBy }),
    ...(item.rule === undefined
      ? {}
      : { rule: { ...item.rule, sentence: sentenceOf(item) } }),
    ...(restated === null
      ? {}
      : { duplicateOf: { id: restated.id, statement: restated.statement } }),
    ...(item.proposalId === undefined ? {} : { proposalId: item.proposalId }),
    evidence: item.evidence.map((each) => ({
      ref: evidenceRef(each),
      document: each.document,
      ...(each.heading === undefined ? {} : { heading: each.heading }),
      ...(each.url === undefined ? {} : { url: each.url }),
      source: sources.get(each.sourceId)?.name ?? each.sourceId,
      stale: each.stale,
      ...callOf(each, sources.get(each.sourceId)),
    })),
    createdAt: item.createdAt,
    ...(item.decidedAt === undefined ? {} : { decidedAt: item.decidedAt }),
    ...(item.decidedBy === undefined ? {} : { decidedBy: item.decidedBy }),
  };
}

function sourcesOf(store: SqliteMemoryStore): Map<string, MemorySourceRecord> {
  return new Map(store.sources().map((each) => [each.id, each]));
}

/** Who made the call a piece of evidence was read from, by name only, so the map can join it to them. */
function callOf(
  evidence: MemoryEvidence,
  source: MemorySourceRecord | undefined,
): { call?: MemoryCallView } {
  if (source === undefined || !isCallSource(source.kind)) return {};
  const call = readToolCallSync(source.location, evidence.document);
  if (call === null) return {};
  return {
    call: {
      via: call.via,
      agent: call.agent,
      ...(call.sessionId === undefined ? {} : { sessionId: call.sessionId }),
      ...(call.app === undefined ? {} : { app: call.app }),
      ...(call.server === undefined ? {} : { server: call.server }),
      tool: call.tool,
      at: call.at,
    },
  };
}

function sentenceOf(item: MemoryItem): string {
  const policy = learnedPolicy(item);
  return policy === null ? item.statement : sentenceOfRule(policy);
}

export async function sourcesView(
  store: SqliteMemoryStore,
  secrets: SecretStore,
): Promise<MemorySourceView[]> {
  const counts = store.countsBySource();
  const views: MemorySourceView[] = [];
  for (const source of store.sources()) {
    const by = counts.get(source.id) ?? {};
    views.push({
      id: source.id,
      kind: source.kind,
      name: source.name,
      location: source.location,
      trust: source.trust,
      scope: source.scope,
      ...(source.project === undefined ? {} : { project: source.project }),
      watched: isFileSource(source.kind),
      ...(await keyHeld(source, secrets)),
      ...(source.lastReadAt === undefined ? {} : { lastReadAt: source.lastReadAt }),
      ...(source.lastError === undefined ? {} : { lastError: source.lastError }),
      counts: {
        candidate: countOf(by, 'candidate'),
        verified: countOf(by, 'verified'),
        conflicting: countOf(by, 'conflicting'),
        outdated: countOf(by, 'outdated'),
        rejected: countOf(by, 'rejected'),
      },
    });
  }
  return views;
}

function countOf(
  by: Partial<Record<MemoryStatus, number>>,
  status: MemoryStatus,
): number {
  return by[status] ?? 0;
}

/** Only for a source that names a key, so listing sources never opens the keychain for nothing. */
async function keyHeld(
  source: MemorySourceRecord,
  secrets: SecretStore,
): Promise<{ keyHeld?: boolean }> {
  if (source.kind !== MEMORY_SOURCE_KIND.SUPERMEMORY) return {};
  if (source.secret === undefined) return { keyHeld: false };
  const value = await secrets.get(source.secret).catch(() => undefined);
  return { keyHeld: value !== undefined && value !== '' };
}
