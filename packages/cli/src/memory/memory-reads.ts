import {
  EXTRACTOR_STATE,
  SqliteMemoryStore,
  type MemoryReadSummary,
  type SourceReach,
} from '@memnox/core';
import type { ExtractRun } from './memory-brain';
import { readMemorySource } from './memory-read';

/**
 * One read of a source at a time, whoever asked, so a second ask joins the running read and a screen that just added
 * a source shows that read's result. Each read opens its own store, since it can outlive the request.
 */

const reading = new Map<string, Promise<MemoryReadSummary>>();

interface SourceReadDeps {
  reach: SourceReach;
  extract: ExtractRun;
  now: () => Date;
}

export function readSourceOnce(
  home: string,
  sourceId: string,
  deps: SourceReadDeps,
): Promise<MemoryReadSummary> {
  const key = `${home}\n${sourceId}`;
  const running = reading.get(key);
  if (running !== undefined) return running;
  const read = readOnce(home, sourceId, deps).finally(() => reading.delete(key));
  reading.set(key, read);
  return read;
}

async function readOnce(
  home: string,
  sourceId: string,
  deps: SourceReadDeps,
): Promise<MemoryReadSummary> {
  const store = SqliteMemoryStore.forHome(home);
  try {
    const record = store.source(sourceId);
    if (record === null) return { ...gone(sourceId), error: 'That source is gone.' };
    return await readMemorySource(store, record, deps);
  } finally {
    store.close();
  }
}

function gone(sourceId: string): MemoryReadSummary {
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
  };
}
