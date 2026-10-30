import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';

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
  trustOf,
  type MemorySource,
  type MemorySourceKind,
  type SourceDocument,
  type SourceDocumentRef,
  type SourceTrust,
} from './memory-source';

/**
 * The sources that are files on this machine: an Obsidian vault, a folder of Markdown, a Notion
 * export, and the instruction files agents read in one repository. Each walk is bounded in files
 * and in bytes, and never follows into a dot folder, so `.obsidian` and `.git` are not read.
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
      return new FolderSource(kind, root, () => walk(root));
    case MEMORY_SOURCE_KIND.NOTION_EXPORT:
      return new FolderSource(kind, root, () => walk(root), notionTitle);
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
    const found: SourceDocumentRef[] = [];
    for (const path of (await this.files()).slice(0, MOST_DOCUMENTS)) {
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile() || info.size > MOST_FILE_BYTES) continue;
      found.push({
        document: relativeOf(this.root, path),
        stamp: `${info.mtimeMs}:${info.size}`,
      });
    }
    return found;
  }

  async read(ref: SourceDocumentRef): Promise<SourceDocument | null> {
    const path = join(this.root, ref.document);
    const info = await stat(path).catch(() => null);
    if (info === null || !info.isFile() || info.size > MOST_FILE_BYTES) return null;
    const read = await readFile(path, 'utf8').catch(() => null);
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

/** Markdown under a folder, breadth first and bounded, never into a dot folder. */
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
        if (found.length >= MOST_DOCUMENTS) return found;
      }
    }
    level = next;
  }
  return found;
}

function isMarkdown(name: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** The instruction files that are there, and every rule file under `.cursor/rules`. */
async function instructionFiles(root: string): Promise<string[]> {
  const rules = join(root, CURSOR_RULES_DIR);
  const entries = await readdir(rules, { withFileTypes: true }).catch(() => []);
  return [
    ...[...INSTRUCTION_FILES, CURSOR_RULES_FILE].map((name) => join(root, name)),
    ...entries
      .filter((entry) => entry.isFile() && isMarkdown(entry.name))
      .map((entry) => join(rules, entry.name)),
  ];
}

/** A Notion page's title without the id Notion appends, which nobody wrote. */
function notionTitle(document: string): string {
  const name = basename(document, extname(document));
  return name.replace(NOTION_ID_SUFFIX, '');
}
