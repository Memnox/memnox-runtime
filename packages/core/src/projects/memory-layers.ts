import { createHash } from 'node:crypto';

import {
  markdownMarked,
  OURS_MARKER,
  type NativeBlockMarkers,
} from '../distribute/native-files';
import type { MemoryLayerFilePlan } from '../daemon/memory-layers';
import { withoutLeading, withoutTrailing } from '../domain/plain-text';

/**
 * The three memory layers as text, with no file read here: the MEMORY.md index with one line per
 * memory linked to its file, the router block with one line per department, and what a plan's
 * digest is taken over. The reads and the writes are the CLI's, after the person confirms.
 */

/** The index every chat reads, at the top of a repository. */
export const MEMORY_INDEX_FILE = 'MEMORY.md';
/** Where the memories the index links to are written, one file each. */
export const MEMORY_FILES_DIR = 'memory';
/** Cursor reads every file in its rules folder, so the router is a file of ours there. */
export const CURSOR_LAYERS_FILE = '.cursor/rules/memnox-layers.mdc';

/** The fence around the index Memnox wrote inside MEMORY.md. */
export const MEMORY_INDEX_MARKERS: NativeBlockMarkers = {
  begin: `<!-- ${OURS_MARKER}: the memory index -->`,
  end: '<!-- memnox: end of the memory index -->',
};

/** The fence around the router Memnox wrote inside an agent's instruction file. */
export const MEMORY_ROUTER_MARKERS: NativeBlockMarkers = {
  begin: `<!-- ${OURS_MARKER}: the memory router -->`,
  end: '<!-- memnox: end of the memory router -->',
};

/** One memory as the index lists it: what it is called, the file it is in, and its line. */
export interface IndexedMemory {
  title: string;
  /** Relative to the repository. */
  file: string;
  summary: string;
}

/** A folder with its own instruction file, which the router sends its work to. */
export interface Department {
  name: string;
  /** Relative to the repository. */
  file: string;
}

export interface RouterInput {
  departments: readonly Department[];
  /** SKILL.md files that say where live data is, relative to the repository. */
  skills: readonly { name: string; path: string }[];
  keep: readonly string[];
}

/** Where a Markdown link's target opens, which is what makes a line of the index point at a file. */
const LINK_OPEN = '](';
/** Words that say a skill reads data live rather than from what it was told. */
const LIVE_DATA =
  /\b(database|table|sql|query|postgres|mysql|sqlite|bigquery|snowflake|endpoint|api)\b|https?:\/\//i;
const MOST_SLUG_CHARS = 60;

/** The index's lines, one per memory, each linked to its own file. */
export function indexLines(memories: readonly IndexedMemory[]): string[] {
  return memories.map(
    (memory) => `- [${memory.title}](${memory.file}) ${memory.summary}`,
  );
}

/** Lines that say something and link nowhere; headings, comments and blank lines say nothing to link. */
export function unlinkedLines(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('<!--'))
    .filter((line) => !hasLink(line)).length;
}

/** Whether a line holds a markdown link, `](target)`, found by index so a long run of `](` costs its length. */
function hasLink(line: string): boolean {
  const lastClose = line.lastIndexOf(')');
  for (
    let open = line.indexOf(LINK_OPEN);
    open !== -1;
    open = line.indexOf(LINK_OPEN, open + 1)
  ) {
    const target = open + LINK_OPEN.length;
    if (target >= lastClose) return false;
    if (line[target] !== ')') return true;
  }
  return false;
}

/** The router's lines: the index first, then each department, each live data skill, and what to keep. */
export function routerLines(input: RouterInput): string[] {
  const lines = [
    `Read ${MEMORY_INDEX_FILE} at the start of every chat; it links each memory to its own file.`,
  ];
  if (input.departments.length > 0)
    lines.push('', '## Departments', '', ...departmentLines(input.departments));
  if (input.skills.length > 0)
    lines.push(
      '',
      '## Live data',
      '',
      ...input.skills.map((skill) => `- ${skill.name}: ${skill.path}`),
    );
  const keep = input.keep.map((line) => line.trim()).filter((line) => line !== '');
  if (keep.length > 0)
    lines.push(
      '',
      '## Keep when the chat compacts',
      '',
      ...keep.map((line) => `- ${line}`),
    );
  return lines;
}

function departmentLines(departments: readonly Department[]): string[] {
  return departments.map(
    (each) => `- ${each.name}: read ${each.file} before working there`,
  );
}

/** How many departments the router text names by their file. */
export function departmentsRouted(
  text: string,
  departments: readonly Department[],
): number {
  return departments.filter((each) => text.includes(each.file)).length;
}

/** What the router's block keeps when a chat compacts, as it was last written. */
export function keptLines(block: string): string[] {
  const start = block.indexOf('## Keep when the chat compacts');
  if (start < 0) return [];
  return block
    .slice(start)
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

export function isLiveDataSkill(text: string): boolean {
  return LIVE_DATA.test(text);
}

/** A memory's own file, marked as ours so it is only ever replaced by Memnox. */
export function memoryFileText(memory: { title: string; statement: string }): string {
  return markdownMarked(`# ${memory.title}\n\n${memory.statement}\n`);
}

/** A file name from a memory's subject, lowercase and plain, never a path. */
export function memorySlug(subject: string, id: string): string {
  const dashed = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const words = withoutLeading(withoutTrailing(dashed, '-'), '-').slice(
    0,
    MOST_SLUG_CHARS,
  );
  return words === '' ? id.toLowerCase().replace(/[^a-z0-9]+/g, '-') : words;
}

/** The digest the person confirms: every file's path, what it holds now and what it would hold, in order. */
export function layersPlanDigest(files: readonly MemoryLayerFilePlan[]): string {
  const hash = createHash('sha256');
  for (const file of files)
    hash.update(
      `${file.path}\n${file.before.join('\n')}\n\0${file.after.join('\n')}\n\0`,
    );
  return hash.digest('hex');
}
