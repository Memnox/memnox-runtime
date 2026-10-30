import { mkdtemp } from 'node:fs/promises';
import type { FSWatcher, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_SCOPE,
  MEMORY_SOURCE_KIND,
  SOURCE_TRUST,
  SqliteMemoryStore,
} from '@memnox/core';
import { MemoryWatch, rewatchMemory } from '../src/memory/memory-watch';

/**
 * A changed file reads its source again once the burst settles, a repository only at its
 * instruction files, an API never, and an add or a remove rewatches at once.
 */

type Listener = (event: string, name: string | null) => void;

function fakeWatch(): {
  watch: typeof watch;
  paths: string[];
  fire: (path: string, name: string) => void;
} {
  const listeners = new Map<string, Listener>();
  const paths: string[] = [];
  const fake = ((path: string, _options: unknown, listener: Listener): FSWatcher => {
    paths.push(path);
    listeners.set(path, listener);
    // Cast is safe: the watcher only ever closes what it opened.
    return { close: () => listeners.delete(path) } as unknown as FSWatcher;
  }) as unknown as typeof watch;
  return {
    watch: fake,
    paths,
    fire: (path, name) => {
      const listener = listeners.get(path);
      if (listener !== undefined) listener('change', name);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the memory watcher', () => {
  it('reads a vault once after a burst of saves, ignores dot folders, and never watches an API', async () => {
    vi.useFakeTimers();
    const home = await mkdtemp(join(tmpdir(), 'memnox-memory-watch-'));
    const store = SqliteMemoryStore.forHome(home);
    const base = {
      trust: SOURCE_TRUST.TRUSTED,
      scope: MEMORY_SCOPE.PERSONAL,
      addedAt: 'x',
    };
    store.putSource({
      ...base,
      id: 'vault',
      kind: MEMORY_SOURCE_KIND.OBSIDIAN,
      name: 'V',
      location: '/vault',
    });
    store.putSource({
      ...base,
      id: 'repo',
      kind: MEMORY_SOURCE_KIND.INSTRUCTIONS,
      name: 'R',
      location: '/repo',
    });
    store.putSource({
      ...base,
      id: 'sm',
      kind: MEMORY_SOURCE_KIND.SUPERMEMORY,
      name: 'S',
      location: 'https://x',
    });
    store.close();
    const reads: string[] = [];
    const fake = fakeWatch();
    const watcher = new MemoryWatch(home, {
      read: async (id) => reads.push(id),
      log: () => undefined,
      watch: fake.watch,
    });
    watcher.start();
    expect(fake.paths).toEqual(['/vault', '/repo', join('/repo', '.cursor', 'rules')]);

    fake.fire('/vault', 'ops.md');
    fake.fire('/vault', 'ops.md');
    fake.fire('/vault', '.obsidian/workspace.json');
    fake.fire('/repo', 'src/index.ts');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reads).toEqual(['vault']);

    fake.fire('/repo', 'CLAUDE.md');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reads).toEqual(['vault', 'repo']);

    const again = SqliteMemoryStore.forHome(home);
    again.removeSource('vault', 'y');
    again.close();
    rewatchMemory(home);
    expect(fake.paths.slice(3)).toEqual(['/repo', join('/repo', '.cursor', 'rules')]);
    watcher.stop();
  });
});
