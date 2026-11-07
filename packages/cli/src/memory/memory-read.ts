import {
  EXTRACT_SHAPE,
  EXTRACTOR_STATE,
  MEMORY_ORIGIN,
  MEMORY_STATUS,
  memoryExtractPrompt,
  memorySourceFor,
  MOST_PASSAGES_PER_BATCH,
  parseExtraction,
  passageDigest,
  SKIP_REASON,
  SOURCE_TRUST,
  type ExtractedCandidate,
  type ExtractPassage,
  type ExtractorState,
  type MemoryReadSummary,
  type MemorySource,
  type MemorySourceRecord,
  type NewMemoryItem,
  type SkippedDocument,
  type SourceReach,
  type SqliteMemoryStore,
} from '@memnox/core';
import type { ExtractRun } from './memory-brain';

/**
 * One source read again: what went away is dropped, what changed is split into passages, and only
 * passages never read before go to the extractor, in bounded batches. Evidence whose passage is no
 * longer there goes stale, and an item left with none goes outdated.
 */

/** Passages one read hands the extractor at most; the rest wait for the next read. */
const MOST_PASSAGES_PER_READ = 200;
/** What the extractor is told is known already, so it does not suggest it again. */
const MOST_KNOWN_TOLD = 30;

interface ReadDeps {
  reach: SourceReach;
  extract: ExtractRun;
  now: () => Date;
}

/** A changed document's passages, and which of them were never read before. */
interface Changed {
  document: string;
  stamp: string;
  passages: ExtractPassage[];
  fresh: ExtractPassage[];
}

/** What a read found changed, and the documents it passed over. */
interface Found {
  changed: Changed[];
  skipped: SkippedDocument[];
}

type Tally = Omit<MemoryReadSummary, 'sourceId' | 'documents' | 'passages' | 'outdated'>;

export async function readMemorySource(
  store: SqliteMemoryStore,
  record: MemorySourceRecord,
  deps: ReadDeps,
): Promise<MemoryReadSummary> {
  const at = deps.now().toISOString();
  const source = memorySourceFor(record, deps.reach);
  if (source === null)
    return failed(store, record, at, 'Nothing can read this source here.');
  let found: Found;
  try {
    found = await changedDocuments(store, record, source);
  } catch (err) {
    return failed(store, record, at, err instanceof Error ? err.message : String(err));
  }
  const { changed, skipped } = found;
  const fresh = changed.flatMap((each) => each.fresh).slice(0, MOST_PASSAGES_PER_READ);
  const { tally, answered } = await extractAll(store, record, { fresh, deps, at });
  for (const each of changed) keepDocument(store, record.id, each, answered);
  const outdated = store.refreshStaleness(record.id, at);
  store.markRead(record.id, at);
  return {
    sourceId: record.id,
    documents: changed.length,
    passages: fresh.length,
    ...tally,
    outdated,
    ...(skipped.length === 0 ? {} : { skipped }),
  };
}

/** Gone documents dropped; changed ones read and split, with what is new in each. */
async function changedDocuments(
  store: SqliteMemoryStore,
  record: MemorySourceRecord,
  source: MemorySource,
): Promise<Found> {
  const seen = store.documentStamps(record.id);
  const listed = await source.list();
  const present = new Set(listed.map((each) => each.document));
  for (const document of seen.keys())
    if (!present.has(document)) store.dropDocument(record.id, document);
  const changed: Changed[] = [];
  const skipped = [...(source.skipped?.() ?? [])];
  for (const ref of listed.filter((each) => seen.get(each.document) !== each.stamp)) {
    const read = await source.read(ref);
    if (read === null) {
      store.dropDocument(record.id, ref.document);
      skipped.push({ document: ref.document, reason: SKIP_REASON.UNREADABLE });
      continue;
    }
    const known = store.knownDigests(record.id, ref.document);
    const passages = read.passages.map((each) => extractPassage(record, each));
    const fresh = passages.filter((each) => !known.has(each.digest));
    changed.push({ document: ref.document, stamp: ref.stamp, passages, fresh });
  }
  return { changed, skipped };
}

function extractPassage(
  record: MemorySourceRecord,
  passage: Omit<ExtractPassage, 'sourceId' | 'sourceKind' | 'tainted' | 'digest'>,
): ExtractPassage {
  return {
    ...passage,
    sourceId: record.id,
    sourceKind: record.kind,
    tainted: record.trust === SOURCE_TRUST.TAINTED,
    digest: passageDigest(passage),
  };
}

/** Each batch extracted and its candidates kept; a batch nobody answered waits for the next read. */
async function extractAll(
  store: SqliteMemoryStore,
  record: MemorySourceRecord,
  { fresh, deps, at }: { fresh: ExtractPassage[]; deps: ReadDeps; at: string },
): Promise<{ tally: Tally; answered: Set<string> }> {
  const tally: Tally = {
    added: 0,
    merged: 0,
    rejectedBefore: 0,
    droppedCitations: 0,
    discarded: 0,
    extractor: EXTRACTOR_STATE.IDLE,
  };
  const answered = new Set<string>();
  for (let start = 0; start < fresh.length; start += MOST_PASSAGES_PER_BATCH) {
    const batch = fresh.slice(start, start + MOST_PASSAGES_PER_BATCH);
    const text = await deps.extract(memoryExtractPrompt(batch, knownStatements(store)));
    const state = stateOf(text);
    if (tally.extractor !== EXTRACTOR_STATE.ANSWERED) tally.extractor = state;
    if (text === null || state !== EXTRACTOR_STATE.ANSWERED) continue;
    const read = parseExtraction(text, batch.length);
    tally.droppedCitations += read.droppedCitations;
    tally.discarded += read.discarded;
    for (const candidate of read.candidates)
      count(tally, store.add(itemOf(record, batch, candidate), at));
    for (const passage of batch) answered.add(passage.digest);
  }
  return { tally, answered };
}

function stateOf(text: string | null): ExtractorState {
  if (text === null) return EXTRACTOR_STATE.UNAVAILABLE;
  return parseExtraction(text, 0).shape === EXTRACT_SHAPE.ANSWERED
    ? EXTRACTOR_STATE.ANSWERED
    : EXTRACTOR_STATE.UNREADABLE;
}

function count(tally: Tally, outcome: ReturnType<SqliteMemoryStore['add']>): void {
  if ('added' in outcome) tally.added += 1;
  else if ('merged' in outcome) tally.merged += 1;
  else tally.rejectedBefore += 1;
}

function knownStatements(store: SqliteMemoryStore): string[] {
  return store
    .items({
      statuses: [MEMORY_STATUS.VERIFIED, MEMORY_STATUS.CANDIDATE],
      limit: MOST_KNOWN_TOLD,
    })
    .map((each) => each.statement);
}

/** A candidate with the passages it cited as evidence, tainted where any of them is. */
function itemOf(
  record: MemorySourceRecord,
  batch: readonly ExtractPassage[],
  candidate: ExtractedCandidate,
): NewMemoryItem {
  const cited = candidate.cites
    .map((index) => batch[index])
    .filter((each): each is ExtractPassage => each !== undefined);
  const by = suggesterOf(cited);
  return {
    kind: candidate.kind,
    statement: candidate.statement,
    subject: candidate.subject,
    scope: record.scope,
    ...(record.project === undefined ? {} : { project: record.project }),
    origin: MEMORY_ORIGIN.EXTRACTED,
    sourceId: record.id,
    tainted: cited.some((each) => each.tainted),
    confidence: candidate.confidence,
    ...(by === undefined ? {} : { suggestedBy: by }),
    ...(candidate.rule === undefined ? {} : { rule: candidate.rule }),
    evidence: cited.map((each) => ({
      sourceId: each.sourceId,
      document: each.document,
      ...(each.heading === undefined ? {} : { heading: each.heading }),
      ...(each.url === undefined ? {} : { url: each.url }),
      digest: each.digest,
    })),
  };
}

/** The one agent whose calls every cited passage came from, so a fact read out of its calls is its suggestion. */
function suggesterOf(cited: readonly ExtractPassage[]): string | undefined {
  const agents = new Set(cited.map((each) => each.by));
  const [only] = [...agents];
  return agents.size === 1 && only !== undefined && only !== '' ? only : undefined;
}

/** The passages read are kept; a document with any left unread keeps no stamp, so it is read again. */
function keepDocument(
  store: SqliteMemoryStore,
  sourceId: string,
  changed: Changed,
  answered: ReadonlySet<string>,
): void {
  const unread = changed.fresh.filter((each) => !answered.has(each.digest));
  const kept = changed.passages
    .filter((each) => !unread.includes(each))
    .map((each) => ({
      digest: each.digest,
      text: each.text,
      ...(each.heading === undefined ? {} : { heading: each.heading }),
    }));
  store.putDocument(
    sourceId,
    changed.document,
    unread.length === 0 ? changed.stamp : '',
    kept,
  );
}

function failed(
  store: SqliteMemoryStore,
  record: MemorySourceRecord,
  at: string,
  error: string,
): MemoryReadSummary {
  store.markRead(record.id, at, error);
  return {
    sourceId: record.id,
    documents: 0,
    passages: 0,
    added: 0,
    merged: 0,
    rejectedBefore: 0,
    droppedCitations: 0,
    discarded: 0,
    outdated: 0,
    extractor: EXTRACTOR_STATE.IDLE,
    error,
  };
}
