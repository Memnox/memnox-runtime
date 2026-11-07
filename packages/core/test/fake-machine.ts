import type { HardenWriter, MachineReader } from '../src/discovery/ports';

/**
 * A path as the fixtures write it, with `/`, since the code joins with `\\` on Windows and the same file must be
 * found whichever separator built its name.
 */
const asWritten = (path: string): string => path.split('\\').join('/');

/** An in-memory machine: every detector is a pure function of what this says exists. */
export class FakeMachine implements MachineReader, HardenWriter {
  private readonly files: Map<string, string>;

  constructor(
    files: Map<string, string>,
    private readonly home = '/home/dev',
    private readonly user = 'dev',
  ) {
    this.files = new Map([...files].map(([path, text]) => [asWritten(path), text]));
  }

  static from(files: Record<string, string>, home = '/home/dev'): FakeMachine {
    return new FakeMachine(new Map(Object.entries(files)), home);
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
    return this.home;
  }

  userName(): string {
    return this.user;
  }

  async write(path: string, contents: string): Promise<void> {
    this.files.set(asWritten(path), contents);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(asWritten(path));
  }

  get written(): string[] {
    return [...this.files.keys()];
  }
}
