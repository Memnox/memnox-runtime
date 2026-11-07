import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { MEMNOX_HOME, readReadTokens, type MemoryValueView } from '@memnox/core';

/**
 * How long memory searches took on this machine, the recent ones only, so the Memory page can say
 * how fast finding is with a number that was measured here. Nothing else is kept about a search:
 * no words, no results, only how many milliseconds it took.
 */

const TIMES_FILE = 'memory-search-times.json';
/** Enough searches for a median that one slow first search does not move. */
const MOST_TIMES_KEPT = 50;

function timesPathFor(home: string): string {
  return join(home, MEMNOX_HOME, TIMES_FILE);
}

async function readTimes(home: string): Promise<number[]> {
  const text = await readFile(timesPathFor(home), 'utf8').catch(() => '[]');
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter((each): each is number => typeof each === 'number' && each >= 0)
      : [];
  } catch {
    // A file cut short starts the count again rather than failing a search.
    return [];
  }
}

/** One search's milliseconds kept, the oldest dropped past the last fifty. */
export async function noteSearchTime(home: string, ms: number): Promise<void> {
  const times = [...(await readTimes(home)), Math.max(0, Math.round(ms))].slice(
    -MOST_TIMES_KEPT,
  );
  await mkdir(dirname(timesPathFor(home)), { recursive: true });
  await writeFile(timesPathFor(home), JSON.stringify(times), 'utf8');
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? Math.round((low + high) / 2) : high;
}

/** What memory measured about itself: how fast a search is, and what budgeted reads spared agents. */
export async function readMemoryValue(home: string): Promise<MemoryValueView> {
  const [times, reads] = await Promise.all([readTimes(home), readReadTokens(home)]);
  const middle = median(times);
  return {
    ...(middle === undefined ? {} : { searchMedianMs: middle, searches: times.length }),
    ...(reads.reads > 0 ? { contextTokensSaved: reads.avoided } : {}),
  };
}
