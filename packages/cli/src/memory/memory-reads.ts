import {
  EXTRACTOR_STATE,
  SqliteMemoryStore,
  type MemoryReadSummary,
  type SourceReach,
} from '@memnox/core';
import type { ExtractRun } from './memory-brain';
import { readMemorySource } from './memory-read';

/**
 * One read of a source at a time, whoever asked: the person pressing read, a file that changed,
 * or the read an add starts. Each opens its own store, since a read can outlive the request.
 */

const reading = new Set<string>();

interface SourceReadDeps {
  reach: SourceReach;
  extract: ExtractRun;
  now: () => Date;
}

export async function readSourceOnce(
  home: string,
  sourceId: string,
  deps: SourceReadDeps,
): Promise<MemoryReadSummary> {
  const key = `${home}\n${sourceId}`;
  if (reading.has(key)) return busy(sourceId);
  reading.add(key);
  const store = SqliteMemoryStore.forHome(home);
  try {
    const record = store.source(sourceId);
    if (record === null) return { ...busy(sourceId), error: 'That source is gone.' };
    return await readMemorySource(store, record, deps);
  } finally {
    store.close();
    reading.delete(key);
  }
}

function busy(sourceId: string): MemoryReadSummary {
  return {
    sourceId,
    documents: 0,
    passages: 0,
    added: 0,
    merged: 0,
    rejectedBefore: 0,
    droppedCitations: 0,
    discarded: 0,
    outdated: 0,
    extractor: EXTRACTOR_STATE.IDLE,
    error: 'A read of this source is already running.',
  };
}
