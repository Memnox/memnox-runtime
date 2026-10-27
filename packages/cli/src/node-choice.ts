import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Node that runs Memnox's daemon and hooks: one of the person's own before one another app
 * bundles, which its next update can move, and only one that really starts Memnox and its database.
 */

/** Long enough for a node to start the CLI or open a database, short enough that a hung one is passed over. */
const NODE_CHECK_MS = 10_000;
/** Opens the database module in memory, which fails at once under a node it was not built for. */
const OPENS_DATABASE =
  "const Database = require(process.argv[1]); new Database(':memory:').close();";

/** Folders in the home directory that hold the person's own Nodes, or Memnox's, rather than another product's. */
const NODE_MANAGERS: readonly string[] = [
  // The Node the Mac app unpacks for Memnox, which is Memnox's own.
  '.memnox',
  '.nvm',
  '.volta',
  '.fnm',
  '.asdf',
  '.nodenv',
  '.n',
  '.local',
  '.bun',
];

/** A Node inside another app: an `.app` bundle, or a product's own folder in the home directory. */
export function isBorrowedNode(path: string, home: string): boolean {
  if (path.includes(`.app${sep}`)) return true;
  const inHome = relative(home, path);
  if (inHome.startsWith('..') || inHome === path) return false;
  const top = inHome.split(sep)[0] ?? '';
  return top.startsWith('.') && !NODE_MANAGERS.includes(top);
}

/** The candidates in the order they are tried: the person's own first, borrowed ones last. */
export function orderedNodes(candidates: readonly string[], home: string): string[] {
  const unique = [...new Set(candidates)];
  return [
    ...unique.filter((node) => !isBorrowedNode(node, home)),
    ...unique.filter((node) => isBorrowedNode(node, home)),
  ];
}

const chosen = new Map<string, string>();

/** The first Node that really runs `entry`, remembered, since checking each one starts a process. */
export function chooseNode(entry: string, home: string = homedir()): string {
  const known = chosen.get(entry);
  if (known !== undefined) return known;
  const database = databaseModule();
  const node =
    orderedNodes([process.execPath, ...nodesOnPath()], home).find((each) =>
      runsMemnox(each, entry, database),
    ) ?? process.execPath;
  chosen.set(entry, node);
  return node;
}

function nodesOnPath(): string[] {
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => join(dir, 'node'))
    .filter((path) => existsSync(path))
    .map((path) => realpathSync(path));
}

/** Where the database module lives, found from the core package that depends on it. */
function databaseModule(): string | null {
  try {
    const core = fileURLToPath(import.meta.resolve('@memnox/core'));
    return createRequire(core).resolve('better-sqlite3');
  } catch {
    return null;
  }
}

function runsMemnox(node: string, entry: string, database: string | null): boolean {
  try {
    execFileSync(node, [entry, '--version'], { stdio: 'ignore', timeout: NODE_CHECK_MS });
    if (database !== null) {
      execFileSync(node, ['-e', OPENS_DATABASE, database], {
        stdio: 'ignore',
        timeout: NODE_CHECK_MS,
      });
    }
    return true;
  } catch {
    return false;
  }
}
