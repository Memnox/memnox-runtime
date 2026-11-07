import { existsSync } from 'node:fs';

import { memoryDatabasePathFor, SqliteMemoryStore } from './memory-store';

/** The retention pass's share of memory: what has said its last word, past the window. */

export const MEMORY_RECORDS = 'memory';

export function dropOldMemory(input: {
  home: string;
  cutoff: string;
  dryRun?: boolean;
}): number {
  // A machine that never added a source has no database, and the pass creates none.
  if (!existsSync(memoryDatabasePathFor(input.home))) return 0;
  const store = SqliteMemoryStore.forHome(input.home);
  try {
    return store.pruneBefore(input.cutoff, input.dryRun === true);
  } finally {
    store.close();
  }
}
