import { nodeSecretStore } from '@memnox/core';
import { claudeExtractor } from './memory-brain';
import { memoryReach } from './memory-reach';
import { readSourceOnce } from './memory-reads';
import { MemoryWatch } from './memory-watch';

/** The daemon's memory watcher, reading a changed source with the person's own agent CLI. */
export function startMemoryWatch(
  home: string,
  log: (message: string) => void,
): MemoryWatch {
  const reach = memoryReach(home, nodeSecretStore(home));
  const extract = claudeExtractor(home);
  const watcher = new MemoryWatch(home, {
    read: (sourceId) =>
      readSourceOnce(home, sourceId, { reach, extract, now: () => new Date() }),
    log,
  });
  watcher.start();
  return watcher;
}
