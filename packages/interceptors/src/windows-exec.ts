/**
 * Finding and starting a real binary on Windows, where `git` is `git.exe` through PATHEXT
 * and a `.cmd` only runs under cmd.exe, which reads its arguments a second time.
 */
import { win32 } from 'node:path';

/** The one platform these rules apply to. */
export const WINDOWS = 'win32';

/** What Windows tries when PATHEXT is unset, in its own order. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Batch files, which only cmd.exe runs and which Node refuses to spawn without it. */
const BATCH_FILE = /\.(?:cmd|bat)$/i;

/** cmd.exe's metacharacters, each escaped with a caret so it reaches the program as text. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Extensions a Windows shell adds when it looks a name up, lower cased. */
function extensionsOf(pathExt: string | undefined): string[] {
  return (pathExt ?? DEFAULT_PATHEXT)
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith('.'));
}

/**
 * The file names `git` is found under on Windows: as typed when it already ends in a
 * PATHEXT extension, otherwise once per extension. A bare name is never runnable there.
 */
export function windowsNamesFor(binary: string, pathExt?: string): string[] {
  const extensions = extensionsOf(pathExt);
  const typed = win32.extname(binary).toLowerCase();
  if (typed !== '' && extensions.includes(typed)) return [binary];
  return extensions.map((extension) => `${binary}${extension}`);
}

/** Every file a PATH entry could answer for a name with, quotes around the entry dropped. */
export function windowsCandidatesIn(
  entry: string,
  binary: string,
  pathExt?: string,
): string[] {
  const directory = entry.replace(/^"(.*)"$/, '$1');
  return windowsNamesFor(binary, pathExt).map((name) => win32.join(directory, name));
}

/** How to start a resolved binary: the file, its arguments, and whether Node must leave them alone. */
export interface SpawnPlan {
  file: string;
  args: string[];
  /** Passed as `windowsVerbatimArguments`, because the line is already quoted for cmd.exe. */
  verbatim: boolean;
}

export interface SpawnHost {
  platform?: NodeJS.Platform;
  /** cmd.exe's path from `ComSpec`, so a machine that moved it is still honoured. */
  comspec?: string;
}

/**
 * A binary spawned directly, except a batch file on Windows, which goes through cmd.exe with
 * every argument quoted and caret escaped the way cross-spawn does, so `&` stays a character.
 */
export function spawnPlanFor(
  real: string,
  args: readonly string[],
  host: SpawnHost = {},
): SpawnPlan {
  const platform = host.platform ?? process.platform;
  if (platform !== WINDOWS || !BATCH_FILE.test(real)) {
    return { file: real, args: [...args], verbatim: false };
  }
  const line = [escapeCommand(real), ...args.map(escapeBatchArgument)].join(' ');
  return {
    file: host.comspec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  };
}

function escapeCommand(command: string): string {
  return command.replace(CMD_META, '^$1');
}

/**
 * Quoted for the program's own parser, then caret escaped twice: once for the cmd.exe that
 * runs the batch file, once for the `%*` line inside it that hands the arguments on.
 */
export function escapeBatchArgument(argument: string): string {
  return quoteForWindows(argument).replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/** The Microsoft C runtime's rule: backslashes double only where a quote follows them. */
function quoteForWindows(argument: string): string {
  let quoted = '"';
  let backslashes = 0;
  for (const char of argument) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    const run = char === '"' ? backslashes * 2 + 1 : backslashes;
    quoted += `${'\\'.repeat(run)}${char}`;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}
