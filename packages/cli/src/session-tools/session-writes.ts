import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { ACTION, type FileChange, type MemnoxEvent } from '@memnox/core';
import { repositoryAround } from './repository-root';

/**
 * Which changed files a session wrote. An agent's own edit tool names the file; a shell command
 * names only the folder it ran in, so a file there is the session's when it changed on disk
 * while that command ran, and never merely because it sits in the same tree as somebody's work.
 */

/** Written by the agent's own edit tool, which the interceptor names this way. */
const FILE_EDIT = 'file.edit';

const WRITES: readonly string[] = [
  ACTION.FILESYSTEM_WRITE,
  ACTION.FILESYSTEM_DELETE,
  FILE_EDIT,
];

/** A clock and a file system disagree by this much, and a write is recorded just before it lands. */
const SLACK_MS = 3_000;
/** How long a shell command is taken to run when the session recorded nothing after it. */
const LONGEST_COMMAND_MS = 10 * 60 * 1_000;
/** Enough folders to find the repositories a session wrote in, never a crawl of the disk. */
const MOST_PLACES = 20;

export interface Touch {
  /** Absolute, or relative to the repository when the edit tool recorded it that way. */
  path: string;
  at: string;
  /** A shell command's folder, which covers what changed beneath it while it ran. */
  folder: boolean;
  /** When the command is taken to have finished: the session's next recorded moment. */
  until: string;
  /** A whole turn in the session's own repository, standing in for writes nothing recorded. */
  turn?: boolean;
}

const WRITE_EVIDENCE = {
  /** The ledger names the file. */
  NAMED: 'named',
  /** It changed while a recorded command ran in its folder. */
  COMMAND: 'command',
  /** It changed in the session's repository while the session was working, and nothing named it. */
  TURN: 'turn',
} as const;

export type WriteEvidence = (typeof WRITE_EVIDENCE)[keyof typeof WRITE_EVIDENCE];

export const FILE_KIND = {
  /** What a person sees: views, styles, markup and images. */
  INTERFACE: 'interface',
  TEST: 'test',
  DOCS: 'docs',
  CONFIG: 'config',
  CODE: 'code',
} as const;

export type FileKind = (typeof FILE_KIND)[keyof typeof FILE_KIND];

export interface SessionWrite extends FileChange {
  /** When this session last wrote it, so the newest work reads first. */
  writtenAt: string;
  /** So "what changed in the UI" is answered from the files rather than guessed from their names. */
  kind: FileKind;
  /** How sure: named by the ledger, changed under a command, or only changed while it worked. */
  evidence: WriteEvidence;
}

/** The session's writes, oldest first; a relative path is placed in the repository it worked in. */
export function touchesOf(rows: readonly MemnoxEvent[], root?: string | null): Touch[] {
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  const touches: Touch[] = [];
  sorted.forEach((row, index) => {
    if (!WRITES.includes(row.operation) || row.target === undefined) return;
    const folder = isFolder(row.target);
    const path = isAbsolute(row.target)
      ? resolved(row.target)
      : root === undefined || root === null
        ? row.target
        : join(root, row.target);
    const next = sorted[index + 1]?.at;
    const longest = new Date(Date.parse(row.at) + LONGEST_COMMAND_MS).toISOString();
    const until = next === undefined || next > longest ? longest : next;
    touches.push({ path, at: row.at, folder, until });
  });
  return touches;
}

/**
 * Each turn as a stretch the session worked in its own repository. A command run through an
 * interpreter writes files the ledger never sees, so this is how that work is still found.
 */
export function turnTouches(
  root: string,
  windows: readonly { promptAt: string; endedAt?: string }[],
  moment: string,
): Touch[] {
  return windows.map((each) => ({
    path: root,
    at: each.promptAt,
    folder: true,
    until: each.endedAt ?? moment,
    turn: true,
  }));
}

/** The repositories the session wrote in, newest first, which is where "what changed" looks. */
export function repositoriesWritten(touches: readonly Touch[]): string[] {
  const roots: string[] = [];
  for (const touch of [...touches].reverse()) {
    if (!isAbsolute(touch.path)) continue;
    const root = repositoryAround(touch.folder ? touch.path : dirname(touch.path));
    if (root !== null && !roots.includes(root)) roots.push(root);
    if (roots.length >= MOST_PLACES) break;
  }
  return roots;
}

/** The first moment the session wrote in this repository, where its work there starts. */
export function firstWriteIn(
  root: string,
  touches: readonly Touch[],
): string | undefined {
  return touches.find((each) => isAbsolute(each.path) && within(root, each.path))?.at;
}

/** The changed files this session wrote, newest first. */
export function writtenBySession(
  root: string,
  changed: readonly FileChange[],
  touches: readonly Touch[],
  modifiedAt: (path: string) => string | null = mtimeOf,
): SessionWrite[] {
  const mine: SessionWrite[] = [];
  for (const change of changed) {
    const absolute = join(root, change.path);
    const named = touches
      .filter((each) => !each.folder)
      .filter((each) => each.path === absolute || each.path === change.path)
      .map((each) => each.at);
    // Read even when a write named it, since a later command in the same folder may have changed it again.
    const modified = modifiedAt(absolute);
    const covering =
      modified === null
        ? []
        : touches
            .filter((each) => each.folder && within(each.path, absolute))
            .filter((each) => whileRunning(modified, each));
    const ran = covering.filter((each) => each.turn !== true);
    const writtenAt = [...named, ...(covering.length === 0 ? [] : [modified ?? ''])]
      .filter((each) => each !== '')
      .sort()
      .pop();
    if (writtenAt === undefined) continue;
    const evidence =
      named.length > 0
        ? WRITE_EVIDENCE.NAMED
        : ran.length > 0
          ? WRITE_EVIDENCE.COMMAND
          : WRITE_EVIDENCE.TURN;
    mine.push({ ...change, writtenAt, kind: kindOf(absolute), evidence });
  }
  return mine.sort((a, b) => b.writtenAt.localeCompare(a.writtenAt));
}

const INTERFACE_EXTENSIONS: readonly string[] = [
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.astro',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.storyboard',
  '.xib',
  '.xaml',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.icns',
  '.ico',
];
const DOCS_EXTENSIONS: readonly string[] = ['.md', '.mdx', '.txt', '.rst'];
const CONFIG_EXTENSIONS: readonly string[] = [
  '.json',
  '.toml',
  '.yaml',
  '.yml',
  '.plist',
  '.lock',
  '.sh',
  '.env',
];
/** A source file that draws on screen says so in its imports, which sit in the first lines. */
const DRAWS_IN_SWIFT = /^\s*import\s+(?:SwiftUI|AppKit|UIKit|Cocoa|MetalKit)\b/m;
/** Anywhere on a line, since `from 'react'` closes an import that opened earlier on it. */
const DRAWS_IN_SCRIPT = /\bfrom\s+['"](?:react|react-dom|vue|svelte)['"]/;
const HEAD_BYTES = 4_096;

/** What kind of file it is, from its name and, for source, the frameworks it imports. */
export function kindOf(path: string): FileKind {
  const name = basename(path).toLowerCase();
  const ext = extname(name);
  if (/(^|\/)(tests?|__tests__|spec)\//i.test(path) || /\.(test|spec)\./.test(name)) {
    return FILE_KIND.TEST;
  }
  if (INTERFACE_EXTENSIONS.includes(ext)) return FILE_KIND.INTERFACE;
  if (DOCS_EXTENSIONS.includes(ext)) return FILE_KIND.DOCS;
  if (CONFIG_EXTENSIONS.includes(ext)) return FILE_KIND.CONFIG;
  const head = headOf(path);
  return DRAWS_IN_SWIFT.test(head) || DRAWS_IN_SCRIPT.test(head)
    ? FILE_KIND.INTERFACE
    : FILE_KIND.CODE;
}

function headOf(path: string): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(HEAD_BYTES);
      return buffer.toString('utf8', 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    // Deleted or unreadable, so it is judged by its name alone.
    return '';
  }
}

function whileRunning(modified: string, touch: Touch): boolean {
  const at = Date.parse(modified);
  return (
    at >= Date.parse(touch.at) - SLACK_MS && at <= Date.parse(touch.until) + SLACK_MS
  );
}

function within(folder: string, path: string): boolean {
  return (
    path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
  );
}

/** A shell command records the folder it ran in, written as the folder or as `folder/.`. */
function isFolder(target: string): boolean {
  if (target.endsWith('/.') || target.endsWith('/')) return true;
  try {
    return isAbsolute(target) && statSync(target).isDirectory();
  } catch {
    // Gone since, so it is taken as the file it was recorded as.
    return false;
  }
}

function mtimeOf(path: string): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    // Deleted, so only a write that named it can claim it.
    return null;
  }
}

/** The path as git prints its root, since /var and /private/var are one folder to the disk and two to a string. */
function resolved(path: string): string {
  const trimmed = path.endsWith('/.') ? path.slice(0, -2) : path.replace(/\/+$/, '');
  try {
    return realpathSync(trimmed);
  } catch {
    try {
      return join(realpathSync(dirname(trimmed)), basename(trimmed));
    } catch {
      // The folder is gone, so the path is kept as the ledger wrote it.
      return trimmed;
    }
  }
}

/** A file the person named by its short name, matched to the one changed file it means. */
export function matchingPath(
  asked: string,
  root: string,
  files: readonly FileChange[],
): string {
  const rel = isAbsolute(asked) ? relative(root, asked) : asked;
  if (files.some((each) => each.path === rel)) return rel;
  const wanted = rel.toLowerCase();
  const found =
    files.find((each) => each.path.toLowerCase().endsWith(`/${wanted}`)) ??
    files.find((each) => basename(each.path).toLowerCase() === basename(wanted));
  return found?.path ?? rel;
}
