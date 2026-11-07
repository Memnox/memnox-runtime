import type {
  EnvironmentSnapshot,
  HardenWriter,
  MachineReader,
  McpLister,
  McpToolDeclaration,
  SnapshotStore,
} from '@memnox/core';
import type { ScanSeams } from '../src/machine-scan';

export const HOME = '/home/dev';
/** A directory the reader is standing in, which holds the credentials a repo has. */
export const PROJECT = '/srv/checkout';

/**
 * A path as the fixtures write it, with `/`, since the code joins with `\\` on Windows and the same file must be
 * found whichever separator built its name.
 */
const asWritten = (path: string): string => path.split('\\').join('/');

/** No fixtures anywhere else: this stands in for the reader's own machine in tests. */
export class FakeMachine implements MachineReader, HardenWriter {
  private readonly files: Map<string, string>;

  constructor(files: Map<string, string>) {
    this.files = new Map([...files].map(([path, text]) => [asWritten(path), text]));
  }

  static from(files: Record<string, string>): FakeMachine {
    return new FakeMachine(new Map(Object.entries(files)));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(asWritten(path));
  }
  async read(path: string): Promise<string | null> {
    return this.files.get(asWritten(path)) ?? null;
  }
  async list(path: string): Promise<string[]> {
    const prefix = `${asWritten(path)}/`;
    return [...this.files.keys()]
      .filter((each) => each.startsWith(prefix))
      .map((each) => each.slice(prefix.length));
  }
  homeDir(): string {
    return HOME;
  }
  userName(): string {
    return 'dev';
  }
  async write(path: string, contents: string): Promise<void> {
    this.files.set(asWritten(path), contents);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(asWritten(path));
  }
  get paths(): string[] {
    return [...this.files.keys()];
  }
}

/** Never the real one: the default starts every MCP server this machine declares. */
export class StubLister implements McpLister {
  constructor(
    private readonly tools:
      McpToolDeclaration[] | Record<string, McpToolDeclaration[]> = [],
  ) {}

  async listTools(server: string): Promise<McpToolDeclaration[]> {
    if (Array.isArray(this.tools)) return this.tools;
    return this.tools[server] ?? [];
  }
}

export const noTools = (): McpLister => new StubLister();

/** In memory, so a test of `diff` never writes the developer's home directory. */
export class MemorySnapshots implements SnapshotStore {
  readonly kept: EnvironmentSnapshot[] = [];

  async latest(at?: string): Promise<EnvironmentSnapshot | null> {
    const candidates =
      at === undefined ? this.kept : this.kept.filter((each) => each.takenAt <= at);
    return candidates[candidates.length - 1] ?? null;
  }

  async history(): Promise<EnvironmentSnapshot[]> {
    return [...this.kept];
  }

  async save(snapshot: EnvironmentSnapshot): Promise<void> {
    this.kept.push(snapshot);
    this.kept.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }
}

interface FakeSeamOptions {
  lister?: () => McpLister;
  projectDirs?: readonly string[];
  /** Successive scan times, so a snapshot history is deterministic in a test. */
  times?: readonly string[];
  policyFiles?: readonly string[];
  snapshots?: MemorySnapshots;
  /** What is in force during the scan, so a freeze is testable without a disk. */
}

/** One fake for every command that reads the machine, so none of them drift apart. */
export function fakeSeams(
  machine: FakeMachine,
  options: FakeSeamOptions = {},
): ScanSeams & { snapshots: MemorySnapshots } {
  const times = options.times ?? [];
  let taken = 0;
  return {
    reader: machine,
    lister: options.lister ?? noTools,
    snapshots: options.snapshots ?? new MemorySnapshots(),
    projectDirs: options.projectDirs ?? [PROJECT],
    now: () => {
      const stamp =
        times[taken] ?? new Date(Date.UTC(2026, 0, 1, 0, taken)).toISOString();
      taken += 1;
      return stamp;
    },
    policyFiles: async () => [...(options.policyFiles ?? [])],
  };
}
