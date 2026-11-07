import { open, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

import { withoutNativeBlock } from '../distribute/native-files';
import {
  CURSOR_RULES_DIR,
  CURSOR_RULES_FILE,
  INSTRUCTION_FILES,
  INSTRUCTION_MARKERS,
} from '../projects/instructions';
import { markdownPassages } from './markdown';
import {
  changedOf,
  MEMORY_SOURCE_KIND,
  SKIP_REASON,
  trustOf,
  type MemorySource,
  type MemorySourceKind,
  type SourceDocument,
  type SourceDocumentRef,
  type SkippedDocument,
  type SourceTrust,
} from './memory-source';

/**
 * The sources that are files on this machine: a vault, a Markdown folder, a Notion export, a repo's agent files,
 * or one picked file. Walks are bounded in files and bytes and skip dot folders, so `.obsidian` and `.git` stay unread.
 */

/** More notes than anybody points at by hand; past it the rest is not read. */
export const MOST_DOCUMENTS = 500;
/** A note past this is an attachment or a dump, never a person's notes. */
export const MOST_FILE_BYTES = 256 * 1024;
/** How deep a walk goes, so a symlink loop or a vendored tree cannot take it with it. */
const MOST_DEPTH = 8;

const MARKDOWN_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdc'];
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules']);

/** Notion names every exported page `Title 0123456789abcdef0123456789abcdef.md`. */
const NOTION_ID_SUFFIX = /\s+[0-9a-f]{32}$/i;

/** The source for a folder of one of the file kinds; null for a kind that is not files. */
export function folderSource(kind: MemorySourceKind, root: string): MemorySource | null {
  switch (kind) {
    case MEMORY_SOURCE_KIND.OBSIDIAN:
    case MEMORY_SOURCE_KIND.MARKDOWN:
      return new FolderSource(kind, root, () => markdownUnder(root));
    case MEMORY_SOURCE_KIND.NOTION_EXPORT:
      return new FolderSource(kind, root, () => markdownUnder(root), notionTitle);
    case MEMORY_SOURCE_KIND.INSTRUCTIONS:
      // What Memnox carried in from the other agents' files is theirs already, so it is not read twice.
      return new FolderSource(
        kind,
        root,
        () => instructionFiles(root),
        undefined,
        (text) => withoutNativeBlock(text, INSTRUCTION_MARKERS),
      );
    default:
      return null;
  }
}

class FolderSource implements MemorySource {
  readonly trust: SourceTrust;
  /** What the last list left out, and why, so a read can say it rather than pass over it. */
  private left: SkippedDocument[] = [];

  constructor(
    readonly kind: MemorySourceKind,
    private readonly root: string,
    private readonly files: () => Promise<string[]>,
    private readonly titleOf?: (document: string) => string,
    private readonly own: (text: string) => string = (text) => text,
  ) {
    this.trust = trustOf(kind);
  }

  async list(): Promise<SourceDocumentRef[]> {
    const base = await baseOf(this.root);
    const files = await this.files();
    const found: SourceDocumentRef[] = [];
    const skipped: SkippedDocument[] = [];
    for (const path of files.slice(0, MOST_DOCUMENTS)) {
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile()) continue;
      const document = relativeOf(base, path);
      if (info.size > MOST_FILE_BYTES) {
        skipped.push({ document, reason: SKIP_REASON.TOO_LARGE });
        continue;
      }
      found.push({ document, stamp: `${info.mtimeMs}:${info.size}` });
    }
    for (const path of files.slice(MOST_DOCUMENTS))
      skipped.push({ document: relativeOf(base, path), reason: SKIP_REASON.PAST_LIMIT });
    this.left = skipped;
    return found;
  }

  skipped(): SkippedDocument[] {
    return this.left;
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    const path = join(await baseOf(this.root), ref.document);
    const read = await boundedText(path);
    if (read === null) return null;
    const text = this.own(read);
    const title = this.titleOf === undefined ? undefined : this.titleOf(ref.document);
    return {
      document: ref.document,
      passages: markdownPassages(ref.document, text, title),
    };
  }

  changedSince(seen: ReadonlyMap<string, string>): Promise<SourceDocumentRef[]> {
    return changedOf(this, seen);
  }
}

/** Forward slashes on every platform, so a citation reads the same on Windows. */
function relativeOf(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/** The folder a source's documents are named from: the location, or the folder holding the one file picked. */
async function baseOf(root: string): Promise<string> {
  const info = await stat(root).catch(() => null);
  return info !== null && info.isFile() ? dirname(root) : root;
}

/** The file itself when one was picked, or the Markdown under the folder. */
async function markdownUnder(root: string): Promise<string[]> {
  const info = await stat(root).catch(() => null);
  if (info !== null && info.isFile()) return isMarkdown(root) ? [root] : [];
  return walk(root);
}

/** Markdown under a folder, breadth first, never into a dot folder; one past the bound says more was there. */
async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  let level = [root];
  for (let depth = 0; depth < MOST_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of level) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) next.push(path);
        else if (entry.isFile() && isMarkdown(entry.name)) found.push(path);
        if (found.length > MOST_DOCUMENTS) return found;
      }
    }
    level = next;
  }
  return found;
}

export function isMarkdown(name: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** The instruction files that are there, and every rule file under `.cursor/rules`; or the one file picked. */
async function instructionFiles(root: string): Promise<string[]> {
  const info = await stat(root).catch(() => null);
  if (info !== null && info.isFile()) return isInstructionFile(root) ? [root] : [];
  const rules = join(root, CURSOR_RULES_DIR);
  const entries = await readdir(rules, { withFileTypes: true }).catch(() => []);
  return [
    ...[...INSTRUCTION_FILES, CURSOR_RULES_FILE].map((name) => join(root, name)),
    ...entries
      .filter((entry) => entry.isFile() && isMarkdown(entry.name))
      .map((entry) => join(rules, entry.name)),
  ];
}

/** CLAUDE.md, AGENTS.md and the rest by name, or a Cursor rule file, which is what an instructions source reads. */
export function isInstructionFile(path: string): boolean {
  const name = basename(path);
  return (
    [...INSTRUCTION_FILES, CURSOR_RULES_FILE].includes(name) ||
    extname(name).toLowerCase() === '.mdc'
  );
}

/** A Notion page's title without the id Notion appends, which nobody wrote. */
function notionTitle(document: string): string {
  const name = basename(document, extname(document));
  return name.replace(NOTION_ID_SUFFIX, '');
}

/**
 * A file's text when it is a file no larger than a source reads, checked and read through one open handle, so the
 * file that was measured is the file that is read even when the path is swapped between the two.
 */
async function boundedText(path: string): Promise<string | null> {
  const handle = await open(path, 'r').catch(() => null);
  if (handle === null) return null;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MOST_FILE_BYTES) return null;
    return await handle.readFile('utf8');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
