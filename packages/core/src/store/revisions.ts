import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { isMissingFile, writeAtomic } from './atomic-file';
import { exclusively } from './exclusive';
import { JsonRecordDir } from './json-records';

/**
 * What a rule file or the autopilot's allowances said before each change, so a person can see
 * every step that widened or narrowed what an agent may do, and step back. A copy is kept before
 * the write, which is what makes a revert itself revertible.
 */

export const REVISIONS_DIR = 'revisions';

/** Enough to walk back a busy week, few enough that the folder never grows. */
export const REVISIONS_KEPT = 50;

export const REVISION_KIND = {
  RULES: 'rules',
  ALLOWANCES: 'allowances',
} as const;

export type RevisionKind = (typeof REVISION_KIND)[keyof typeof REVISION_KIND];

export interface Revision {
  /** Counts up from one and is never reused, so "revert 12" means one thing for good. */
  n: number;
  kind: RevisionKind;
  /** The file the copy came from, absolute, which is where a revert writes it back. */
  file: string;
  at: string;
  /** The file as it was before the change; empty for a file that did not exist yet. */
  content: string;
}

export class FileRevisions {
  private readonly dir: string;
  private readonly records: JsonRecordDir<Revision>;

  constructor(home: string = homedir()) {
    this.dir = join(home, MEMNOX_HOME, REVISIONS_DIR);
    this.records = new JsonRecordDir<Revision>(this.dir);
  }

  /** Copies the file as it stands before it is replaced. A torn read keeps nothing rather than a lie. */
  async keep(file: string, kind: RevisionKind, at: string): Promise<Revision | null> {
    const content = await currentContent(file);
    if (content === null) return null;
    return exclusively(this.dir, async () => {
      const all = await this.all();
      const n = (all[0]?.n ?? 0) + 1;
      const revision: Revision = { n, kind, file, at, content };
      await this.records.write(idOf(n), revision);
      for (const old of all.slice(REVISIONS_KEPT - 1))
        await this.records.remove(idOf(old.n));
      return revision;
    });
  }

  /** Newest first, of one kind or of both. */
  async list(kind?: RevisionKind): Promise<Revision[]> {
    const all = await this.all();
    return kind === undefined ? all : all.filter((each) => each.kind === kind);
  }

  async read(n: number): Promise<Revision | null> {
    return this.records.read(idOf(n));
  }

  /** Puts a revision back, keeping what stands now first so the revert is one more step back. */
  async revert(n: number, at: string): Promise<Revision | null> {
    const revision = await this.read(n);
    if (revision === null) return null;
    await this.keep(revision.file, revision.kind, at);
    await writeAtomic(revision.file, revision.content);
    return revision;
  }

  private async all(): Promise<Revision[]> {
    return (await this.records.all()).sort((a, b) => b.n - a.n);
  }
}

/** Zero padded, so the folder lists in the order the changes were made. */
function idOf(n: number): string {
  return String(n).padStart(6, '0');
}

/** What is on disk now; a file not there yet is an empty one, which a revert writes back as empty. */
async function currentContent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    return isMissingFile(err) ? '' : null;
  }
}
