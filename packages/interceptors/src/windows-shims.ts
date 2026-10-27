/**
 * The `.cmd` files that put the interceptor in front of a binary on Windows, where a
 * `#!/bin/sh` script runs only inside Git Bash and cmd.exe and PowerShell look for PATHEXT.
 */
import { withoutTrailing } from '@memnox/core';

/** What a Windows shim starts: this node and the two entry points, by absolute path. */
export interface WindowsShimEntry {
  /** `process.execPath` at install time, so the shim never depends on which node is on PATH. */
  node: string;
  /** The interceptor's entry script, which reads the binary name from its first argument. */
  intercept: string;
  /** The CLI's entry script, for the launchers that start an agent under `memnox run`. */
  cli: string;
}

/** The extension cmd.exe and PowerShell both resolve through PATHEXT, and no policy can block. */
export const WINDOWS_SHIM_EXTENSION = '.cmd';

/** Batch files are read by cmd.exe, which expects carriage returns. */
const CRLF = '\r\n';

/** `%` doubled, because a batch line expands `%name%` before anything else reads it. */
function batchLiteral(text: string): string {
  return text.replaceAll('%', '%%');
}

/**
 * Our directory taken off PATH in both spellings, with and without the trailing backslash,
 * so the fallback finds the real binary rather than this file again. Substitution ignores case.
 */
function pathWithout(directory: string): string[] {
  const dir = batchLiteral(withoutTrailing(directory, '\\'));
  return [
    'set "PATH=;%PATH%;"',
    `set "PATH=%PATH:;${dir};=;%"`,
    `set "PATH=%PATH:;${dir}\\;=;%"`,
    'set "PATH=%PATH:~1,-1%"',
  ];
}

/**
 * Hands the binary and every argument to the interceptor. `%*` passes the arguments as the
 * caller quoted them, which is the one form cmd.exe does not reparse. Steps aside once Memnox is gone.
 */
export function cmdShimFor(
  binary: string,
  entry: WindowsShimEntry,
  directory: string,
): string {
  return [
    '@echo off',
    `rem Memnox interceptor for ${binary}. Remove this file, or run "memnox uninstall", to undo.`,
    'setlocal',
    `if not exist "${batchLiteral(entry.intercept)}" goto real`,
    `"${batchLiteral(entry.node)}" "${batchLiteral(entry.intercept)}" ${binary} %*`,
    'exit /b %ERRORLEVEL%',
    ':real',
    'rem Memnox is not installed, so run the real one with this directory off PATH.',
    ...pathWithout(directory),
    `${binary} %*`,
    '',
  ].join(CRLF);
}

/**
 * Typing the agent's name starts it under `memnox run`, as the POSIX launcher does. Inside a
 * session, with `MEMNOX_LAUNCH=off`, or for a subcommand that starts nothing, it runs the real one.
 */
export function cmdLauncherFor(
  agent: string,
  entry: WindowsShimEntry,
  directory: string,
  passThrough: readonly string[],
): string {
  return [
    '@echo off',
    `rem Memnox launcher for ${agent}. Remove this file, or run "memnox uninstall", to undo.`,
    'setlocal',
    'if defined MEMNOX_SESSION goto real',
    'if /i "%MEMNOX_LAUNCH%"=="off" goto real',
    `if not exist "${batchLiteral(entry.cli)}" goto real`,
    `for %%a in (${passThrough.join(' ')}) do if /i "%~1"=="%%a" goto real`,
    `"${batchLiteral(entry.node)}" "${batchLiteral(entry.cli)}" run -- ${agent} %*`,
    'exit /b %ERRORLEVEL%',
    ':real',
    ...pathWithout(directory),
    `${agent} %*`,
    '',
  ].join(CRLF);
}

/** One name per wrapped binary, since Windows keeps a `.cmd` beside the Git Bash script. */
export function shimNamesIn(entries: readonly string[]): string[] {
  const names = entries.map((entry) =>
    entry.toLowerCase().endsWith(WINDOWS_SHIM_EXTENSION)
      ? entry.slice(0, -WINDOWS_SHIM_EXTENSION.length)
      : entry,
  );
  return [...new Set(names)];
}
