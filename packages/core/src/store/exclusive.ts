import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * One writer at a time across processes, for a store that reads a file, changes it and writes
 * it back: ten agents on one machine are ten processes, and the second write would lose the first.
 */

/** Longer than any honest critical section, so a lock this old was left by a crash. */
const STALE_MS = 5_000;
const RETRY_MS = 25;
/** Five seconds of waiting, after which contention is a bug rather than load. */
const ATTEMPTS = 200;
const LOCK_NAME = '.lock';

/** `mkdir` is atomic on every platform the runtime supports, which a lock file is not. */
export async function exclusively<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const lock = join(dir, LOCK_NAME);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await reclaimStale(lock);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      continue;
    }
    try {
      return await work();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error(`could not take the lock on ${dir}; run "memnox doctor"`);
}

async function reclaimStale(lock: string): Promise<void> {
  try {
    const { mtimeMs } = await stat(lock);
    if (Date.now() - mtimeMs > STALE_MS) await rm(lock, { recursive: true, force: true });
  } catch {
    // Gone between the failed mkdir and here, which is the outcome wanted anyway.
  }
}
