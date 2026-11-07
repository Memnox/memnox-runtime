import { execFile } from 'node:child_process';
import {
  lstat,
  readdir,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { DEFAULT_SERVER_KEY, MEMNOX_HOME, WORKSPACE_SERVER_NAME } from '@memnox/core';
import { EDIT_HOOK_BINARY } from '@memnox/interceptors';
import { jsonServersKey } from '../agents/managed-json';
import { withoutManagedServer } from '../agents/managed-server';
import { SESSION_TARGETS, type SessionTarget } from '../session-tools/session-entry';
import { PROJECT_CLAUDE_SETTINGS, removeSettingsHook } from './claude-hook';
import { jsonText } from './json-config';
import { managedSettingsPath, withoutManagedHook } from './managed-hook';

/**
 * What `memnox uninstall` used to leave: the hook in Claude Code's personal settings, the hook in its managed
 * settings, a workspace server whose onboarding record was lost, and the CLI package itself. Each removes only
 * what carries our name and our command, so an entry the person wrote stays exactly as it was.
 */

/** The CLI's package name, as npm installs and links it. */
const PACKAGE_NAME = 'memnox';

/** Long enough for npm to answer where its global prefix is, short enough that an uninstall never hangs on it. */
const NPM_PREFIX_TIMEOUT_MS = 5_000;

/** Claude Code's personal settings at home and in this repository, where the project hook is written. */
export async function removeLocalClaudeHooks(
  home: string,
  dir: string,
): Promise<string[]> {
  const paths = [
    ...new Set([
      join(home, '.claude', 'settings.local.json'),
      join(dir, PROJECT_CLAUDE_SETTINGS),
    ]),
  ];
  const removed: string[] = [];
  for (const path of paths) {
    if (await removeSettingsHook(path)) removed.push(path);
  }
  return removed;
}

export const MANAGED_REMOVAL = {
  REMOVED: 'removed',
  NONE: 'none',
  /** The file holds our hook and only root may write it, so the person is told the one command that does. */
  NEEDS_ROOT: 'needs-root',
} as const;

type ManagedRemoval = (typeof MANAGED_REMOVAL)[keyof typeof MANAGED_REMOVAL];

/** Our hook out of Claude Code's managed settings, where it was ever moved there and the file can be written. */
export async function removeManagedClaudeHook(
  target: string | null = managedSettingsPath(),
): Promise<ManagedRemoval> {
  if (target === null) return MANAGED_REMOVAL.NONE;
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
  } catch {
    return MANAGED_REMOVAL.NONE;
  }
  if (!raw.includes(EDIT_HOOK_BINARY)) return MANAGED_REMOVAL.NONE;
  let settings: Record<string, unknown>;
  try {
    // Cast is safe: the managed file is a JSON object, and anything else is refused below as unreadable.
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return MANAGED_REMOVAL.NONE;
  }
  try {
    await writeFile(target, jsonText(withoutManagedHook(settings)));
    return MANAGED_REMOVAL.REMOVED;
  } catch {
    return MANAGED_REMOVAL.NEEDS_ROOT;
  }
}

/**
 * The workspace server left in an agent's config after its onboarding record went, which the hand back cannot
 * find. Only an entry under our name whose own text points at Memnox is taken, never one the person named so.
 */
export async function removeOrphanWorkspaceServers(
  home: string,
  targets: readonly SessionTarget[] = SESSION_TARGETS,
): Promise<string[]> {
  const removed: string[] = [];
  for (const target of targets) {
    const path = join(home, target.file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const toml = path.toLowerCase().endsWith('.toml');
    const key = toml
      ? DEFAULT_SERVER_KEY.toml
      : (jsonServersKey(raw) ?? DEFAULT_SERVER_KEY.json);
    const entry = toml ? tomlEntryText(raw, key) : jsonEntryText(raw, key);
    if (entry === null || !entry.toLowerCase().includes(PACKAGE_NAME)) continue;
    const stripped = withoutManagedServer(raw, key, path);
    if (stripped.next === null || stripped.next === raw) continue;
    await writeFile(path, stripped.next, 'utf8');
    removed.push(target.name);
  }
  return removed;
}

function jsonEntryText(raw: string, key: string): string | null {
  const config: unknown = parse(raw);
  if (typeof config !== 'object' || config === null) return null;
  const servers: unknown = (config as Record<string, unknown>)[key];
  if (typeof servers !== 'object' || servers === null) return null;
  const entry: unknown = (servers as Record<string, unknown>)[WORKSPACE_SERVER_NAME];
  return entry === undefined ? null : JSON.stringify(entry);
}

/** The body of `[<key>.memnox]` up to the next table, which is all TOML lets one server say. */
function tomlEntryText(raw: string, key: string): string | null {
  const header = `[${key}.${WORKSPACE_SERVER_NAME}]`;
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim().startsWith('['));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export const CLI_REMOVAL = {
  /** An `npm link` taken away; the checkout it pointed at is the person's and stays. */
  UNLINKED: 'unlinked',
  UNINSTALLED: 'uninstalled',
  /** The copy the Mac app keeps in `~/.memnox/node`, which goes with the home. */
  WITH_HOME: 'with-home',
  NOT_FOUND: 'not-found',
} as const;

export type CliRemovalState = (typeof CLI_REMOVAL)[keyof typeof CLI_REMOVAL];

export interface CliRemoval {
  state: CliRemovalState;
  /** The package entry that was taken, where one was. */
  where?: string;
}

export interface CliSeams {
  /** The package this memnox runs from. */
  packageDir: string;
  /** Every npm global prefix worth looking under. */
  prefixes: () => Promise<string[]>;
  platform: NodeJS.Platform;
}

/** The package directory the built CLI sits in, one above `dist/`. */
function runningPackage(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function npmPrefix(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('npm', ['prefix', '-g'], { timeout: NPM_PREFIX_TIMEOUT_MS }, (error, out) =>
      resolve(error === null ? out.trim() : null),
    );
  });
}

/** Where npm puts a global package: its own setting, the prefix of the node running this, and ~/.local. */
async function defaultPrefixes(home: string): Promise<string[]> {
  const asked = await npmPrefix();
  const all = [
    process.env['npm_config_prefix'],
    asked,
    dirname(dirname(process.execPath)),
    join(home, '.local'),
  ];
  return [
    ...new Set(
      all.filter(
        (each): each is string => each !== undefined && each !== null && each !== '',
      ),
    ),
  ];
}

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
}

/**
 * The CLI package itself, last of all because this process runs from it. A link loses only the link and the bins
 * that lead into it; an install loses its own folder and those bins; anything else in the prefix is never read.
 */
export async function removeTheGlobalCli(
  home: string,
  seams: Partial<CliSeams> = {},
): Promise<CliRemoval> {
  const platform = seams.platform ?? process.platform;
  // npm lays a Windows prefix out differently, so a Windows install is named rather than guessed at.
  if (platform === 'win32') return { state: CLI_REMOVAL.NOT_FOUND };
  const running = await realOrNull(seams.packageDir ?? runningPackage());
  const memnoxHome = await realOrNull(join(home, MEMNOX_HOME));
  if (running !== null && memnoxHome !== null && within(running, memnoxHome)) {
    return { state: CLI_REMOVAL.WITH_HOME };
  }
  const prefixes = await (seams.prefixes ?? (() => defaultPrefixes(home)))();
  for (const prefix of prefixes) {
    const removed = await removeFromPrefix(prefix);
    if (removed !== null) return removed;
  }
  return { state: CLI_REMOVAL.NOT_FOUND };
}

async function removeFromPrefix(prefix: string): Promise<CliRemoval | null> {
  const entry = join(prefix, 'lib', 'node_modules', PACKAGE_NAME);
  let linked: boolean;
  try {
    linked = (await lstat(entry)).isSymbolicLink();
  } catch {
    return null;
  }
  const target = await realOrNull(entry);
  if (target !== null) await removeBinsInto(join(prefix, 'bin'), target);
  if (linked) {
    await unlink(entry);
    return { state: CLI_REMOVAL.UNLINKED, where: entry };
  }
  await rm(entry, { recursive: true, force: true });
  return { state: CLI_REMOVAL.UNINSTALLED, where: entry };
}

/** Only links that resolve inside the package, so a bin of the same name from anywhere else is left alone. */
async function removeBinsInto(bin: string, target: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(bin);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(bin, name);
    try {
      if (!(await lstat(path)).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const resolved = await realOrNull(path);
    if (resolved !== null && within(resolved, target)) await unlink(path);
  }
}
