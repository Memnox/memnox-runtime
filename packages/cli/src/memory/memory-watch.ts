import { existsSync, mkdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import {
  CURSOR_RULES_DIR,
  CURSOR_RULES_FILE,
  INSTRUCTION_FILES,
  isCallSource,
  isFileSource,
  MEMORY_SOURCE_KIND,
  memoryDatabasePathFor,
  SqliteMemoryStore,
  toolCallsRootFor,
  type MemorySourceRecord,
} from '@memnox/core';

/**
 * Memory sources on this disk read again when a file in them changes, and never on a timer. A
 * repository is watched only at its instruction files, so editing code reads nothing.
 */

/** Long enough for an editor's save dance and a burst of saves to settle into one read. */
const SETTLE_MS = 2_000;

const INSTRUCTION_NAMES: ReadonlySet<string> = new Set([
  ...INSTRUCTION_FILES,
  CURSOR_RULES_FILE,
]);

interface MemoryWatchDeps {
  /** Reads one source again; its own errors land on the source, never here. */
  read: (sourceId: string) => Promise<unknown>;
  log: (message: string) => void;
  watch?: typeof watch;
}

/** The daemon's watcher for each home, so an add or a remove answered here rewatches at once. */
const active = new Map<string, MemoryWatch>();

export function rewatchMemory(home: string): void {
  const found = active.get(home);
  if (found !== undefined) found.rewatch();
}

export class MemoryWatch {
  private watchers: FSWatcher[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly home: string,
    private readonly deps: MemoryWatchDeps,
  ) {}

  start(): void {
    active.set(this.home, this);
    this.rewatch();
  }

  stop(): void {
    active.delete(this.home);
    this.close();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Every file source watched afresh, since one was added or taken away. */
  rewatch(): void {
    this.close();
    // A machine that never added a source has no database, and watching creates none.
    if (existsSync(memoryDatabasePathFor(this.home))) {
      const store = SqliteMemoryStore.forHome(this.home);
      const sources = store
        .sources()
        .filter((each) => isFileSource(each.kind) && !isCallSource(each.kind));
      store.close();
      for (const source of sources) this.follow(source);
    }
    this.followCalls();
  }

  /**
   * Every agent's calls in one watch, since a hook or a session server starts a new app's source
   * without asking the daemon, and the folder a call lands in is named by its source.
   */
  private followCalls(): void {
    const root = toolCallsRootFor(this.home);
    try {
      mkdirSync(root, { recursive: true, mode: 0o700 });
    } catch (err) {
      this.deps.log(`Memory is not keeping agents' calls: ${String(err)}`);
      return;
    }
    const start = this.deps.watch ?? watch;
    try {
      this.watchers.push(
        start(root, { recursive: true }, (_event, name) => {
          const sourceId = name === null ? '' : (String(name).split(/[\\/]/)[0] ?? '');
          if (sourceId !== '' && !isHidden(sourceId)) this.schedule(sourceId);
        }),
      );
    } catch (err) {
      this.deps.log(`Memory is not watching ${root}: ${String(err)}`);
    }
  }

  private follow(source: MemorySourceRecord): void {
    // One file picked is watched as itself, since nothing beside it belongs to the source.
    if (isOneFile(source.location)) {
      this.open(source.location, false, () => true, source.id);
      return;
    }
    if (source.kind !== MEMORY_SOURCE_KIND.INSTRUCTIONS) {
      this.open(
        source.location,
        true,
        (name) => !name.split(/[\\/]/).some(isHidden),
        source.id,
      );
      return;
    }
    this.open(source.location, false, (name) => INSTRUCTION_NAMES.has(name), source.id);
    this.open(join(source.location, CURSOR_RULES_DIR), false, () => true, source.id);
  }

  private open(
    path: string,
    recursive: boolean,
    matters: (name: string) => boolean,
    sourceId: string,
  ): void {
    const start = this.deps.watch ?? watch;
    try {
      this.watchers.push(
        start(path, { recursive }, (_event, name) => {
          // A watcher that names no file reports a change, since an unnamed one may be any.
          const text = name === null ? '' : String(name);
          if (text === '' || matters(text)) this.schedule(sourceId);
        }),
      );
    } catch (err) {
      // A folder that is not there yet is nothing to watch; the next add or restart looks again.
      this.deps.log(
        `Memory is not watching ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private schedule(sourceId: string): void {
    const waiting = this.timers.get(sourceId);
    if (waiting !== undefined) clearTimeout(waiting);
    const timer = setTimeout(() => {
      this.timers.delete(sourceId);
      void this.deps
        .read(sourceId)
        .catch((err: unknown) =>
          this.deps.log(`Memory could not read a changed source: ${String(err)}`),
        );
    }, SETTLE_MS);
    timer.unref();
    this.timers.set(sourceId, timer);
  }

  private close(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}

function isOneFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isHidden(segment: string): boolean {
  return segment.startsWith('.');
}
