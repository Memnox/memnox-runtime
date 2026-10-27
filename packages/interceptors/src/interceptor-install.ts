import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { interceptableBinaries, pathValueOf } from '@memnox/core';

import {
  interceptorDirFor,
  isExecutableFile,
  realPath,
  resolveReal,
} from './interceptor';
import { WINDOWS } from './windows-exec';
import {
  cmdLauncherFor,
  cmdShimFor,
  WINDOWS_SHIM_EXTENSION,
  type WindowsShimEntry,
} from './windows-shims';

/**
 * Installing and removing the per-binary shims
 * that put the interceptor in front of a CLI.
 */

/**
 * Readable and runnable by this user only, since
 * every shim stands in front of a real binary.
 */
const OWNER_ONLY = 0o700;

/**
 * A shell script per binary rather than a symlink, which loses the name it was run as.
 * It steps aside once Memnox is gone, or removing the package broke git and npm.
 */
function scriptFor(binary: string, interceptBinary: string, native?: string): string {
  return [
    '#!/bin/sh',
    `# Memnox interceptor for ${binary}. Remove this file, or run "memnox uninstall", to undo.`,
    ...nativeLines(binary, interceptBinary, native),
    `if command -v "${interceptBinary}" >/dev/null 2>&1; then exec "${interceptBinary}" "${binary}" "$@"; fi`,
    '# Memnox is not installed, so run the real one with this directory off PATH.',
    'here=$(cd "$(dirname "$0")" && pwd)',
    `PATH=$(printf '%s\\n' "$PATH" | tr ':' '\\n' | grep -vxF "$here" | paste -sd: -)`,
    `exec "${binary}" "$@"`,
    '',
  ].join('\n');
}

/** The native wrapper's file name, never `memnox-intercept`, which the shims fall back to. */
export const NATIVE_INTERCEPT_BINARY = 'memnox-intercept-native';

/** Where a package ships the native wrapper for one platform, under its own `native` folder. */
export function nativeInterceptorUnder(
  root: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  return join(root, 'native', `${platform}-${arch}`, NATIVE_INTERCEPT_BINARY);
}

/**
 * The native wrapper first where one was built for this machine. It falls back to the Node
 * interceptor by name, so it is only tried while that one is there to fall back to.
 */
function nativeLines(
  binary: string,
  interceptBinary: string,
  native: string | undefined,
): string[] {
  if (native === undefined) return [];
  const quoted = shellQuoted(native);
  return [
    `if [ -x ${quoted} ] && command -v "${interceptBinary}" >/dev/null 2>&1; then exec ${quoted} "${binary}" "$@"; fi`,
  ];
}

/** Single quoted, since an install path is not ours to trust with a `$` or a quote in it. */
function shellQuoted(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Agent CLIs a person starts by name, each started under `memnox run` from here on. */
export const AGENT_LAUNCHERS: readonly string[] = ['claude', 'codex', 'gemini'];

/** Subcommands that start no session, so they run straight through with nothing set up. */
const NO_SESSION = [
  '--version',
  '-v',
  '--help',
  '-h',
  'mcp',
  'config',
  'update',
  'doctor',
  'login',
  'logout',
];

/**
 * Typing the agent's name starts it under `memnox run`, so the proxy and the wall come with
 * it and nobody has to remember the command. Inside a session, or with Memnox gone, or
 * with `MEMNOX_LAUNCH=off`, it runs the real one with this directory off PATH.
 */
function launcherFor(agent: string): string {
  const passThrough = NO_SESSION.map((each) => `"${each}"`).join(' | ');
  return [
    '#!/bin/sh',
    `# Memnox launcher for ${agent}. Remove this file, or run "memnox uninstall", to undo.`,
    'here=$(cd "$(dirname "$0")" && pwd)',
    'case "$1" in',
    `  ${passThrough}) direct=1 ;;`,
    'esac',
    `if [ -z "$MEMNOX_SESSION" ] && [ "$MEMNOX_LAUNCH" != "off" ] && [ -z "$direct" ] && command -v memnox >/dev/null 2>&1; then`,
    `  exec memnox run -- ${agent} "$@"`,
    'fi',
    `PATH=$(printf '%s\n' "$PATH" | tr ':' '\n' | grep -vxF "$here" | paste -sd: -)`,
    `exec ${agent} "$@"`,
    '',
  ].join('\n');
}

export interface InterceptorInstallReport {
  directory: string;
  installed: string[];
  /** Agent CLIs that now start under `memnox run` when typed by name. */
  launchers: string[];
  /**
   * Known to the rules, absent from this machine. Named so the list is never a mystery.
   */
  absent: string[];
  /** What to add to PATH, printed rather than written into somebody's shell profile. */
  pathLine: string;
}

export interface InstallSeams {
  path?: string;
  exists?: (candidate: string) => boolean;
  /** Injected, so a test on a Mac writes what a Windows install would. */
  platform?: NodeJS.Platform;
  /** Node and the entry scripts the `.cmd` shims start, required on Windows. */
  windows?: WindowsShimEntry;
  /** The native wrapper built for this platform, absent where there is none or on Windows. */
  native?: string;
}

/** Owner only where the mode means something; on Windows the profile's own ACL is what holds. */
async function writeShim(path: string, text: string, windows: boolean): Promise<void> {
  await writeFile(path, text, { encoding: 'utf8', mode: OWNER_ONLY });
  if (!windows) await chmod(path, OWNER_ONLY);
}

/**
 * The script for Git Bash, which is how Claude Code runs commands on Windows, and on Windows
 * a `.cmd` beside it for cmd.exe and PowerShell. No `.ps1`: a restricted execution policy
 * refuses one, and PowerShell would not fall back to the `.cmd`, so the binary would stop working.
 */
async function writeShimPair(
  target: { directory: string; name: string },
  posix: string,
  windowsText: string | null,
): Promise<void> {
  await writeShim(join(target.directory, target.name), posix, windowsText !== null);
  if (windowsText === null) return;
  const cmdPath = join(target.directory, `${target.name}${WINDOWS_SHIM_EXTENSION}`);
  await writeShim(cmdPath, windowsText, true);
}

/** The entry a Windows install needs, refused by name rather than written half working. */
function windowsEntryOf(seams: InstallSeams): WindowsShimEntry | null {
  if ((seams.platform ?? process.platform) !== WINDOWS) return null;
  if (seams.windows === undefined) {
    throw new Error(
      'Interceptors on Windows need the node and entry paths their .cmd shims start.',
    );
  }
  return seams.windows;
}

/** The line that puts the directory first: PowerShell on Windows, a POSIX shell elsewhere. */
export function interceptorPathLine(
  directory: string,
  platform: NodeJS.Platform,
): string {
  return platform === WINDOWS
    ? `$env:Path = "${directory};" + $env:Path`
    : `export PATH="${directory}:$PATH"`;
}

/**
 * Only binaries this machine actually has. A shim for an absent `aws` would answer
 * `command -v aws` and make every script that checks for it take the wrong branch, and
 * a governance tool that breaks a build is a governance tool somebody removes.
 */
export async function installInterceptors(
  home: string,
  interceptBinary: string,
  seams: InstallSeams = {},
): Promise<InterceptorInstallReport> {
  const directory = interceptorDirFor(home);
  const platform = seams.platform ?? process.platform;
  const windows = windowsEntryOf(seams);
  await mkdir(directory, { recursive: true, mode: OWNER_ONLY });
  // Our own directory removed, or a re-install would see its own shims and call the
  // binary present when the machine never had it.
  const path = realPath(seams.path ?? pathValueOf(process.env), home);
  const exists = seams.exists ?? isExecutableFile;
  const isHere = (name: string): boolean =>
    resolveReal(name, path, exists, { platform }) !== null;

  const installed: string[] = [];
  const absent: string[] = [];
  for (const binary of interceptableBinaries()) {
    if (!isHere(binary)) {
      absent.push(binary);
      continue;
    }
    await writeShimPair(
      { directory, name: binary },
      scriptFor(binary, interceptBinary, windows === null ? seams.native : undefined),
      windows === null ? null : cmdShimFor(binary, windows, directory),
    );
    installed.push(binary);
  }

  const launchers = AGENT_LAUNCHERS.filter(isHere);
  for (const agent of launchers) {
    await writeShimPair(
      { directory, name: agent },
      launcherFor(agent),
      windows === null ? null : cmdLauncherFor(agent, windows, directory, NO_SESSION),
    );
  }

  return {
    directory,
    installed,
    launchers,
    absent,
    pathLine: interceptorPathLine(directory, platform),
  };
}

/**
 * Removes every interceptor and the directory, so a machine goes back exactly as it was.
 */
export async function removeInterceptors(home: string): Promise<string[]> {
  const directory = interceptorDirFor(home);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    // Never installed, which is not a failure to uninstall.
    return [];
  }
  for (const name of names) await rm(join(directory, name), { force: true });
  await rm(directory, { recursive: true, force: true });
  return names;
}
