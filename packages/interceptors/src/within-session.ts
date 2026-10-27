/**
 * Whether a held tool call reaches nothing beyond the session's repository, which is what lets
 * the person answer it with a tap rather than their fingerprint. Every action and every path in
 * the call is checked, so `rm a /etc/b` is outside for its second word even where the first is not.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
  isInside,
  resolveShellLine,
  staysInRepository,
  targetsRuledOn,
  type Containment,
} from '@memnox/core';

import type { ToolCall } from './tool-calls';

/** One action the call takes and the path it names. */
interface Reach {
  action: string;
  target?: string;
}

/**
 * What a line can do to the paths it names that a word by word reading cannot follow: a move
 * of the working directory, an expansion, a substitution, an escape.
 */
const UNREADABLE = /[$`{}\\]|(^|[\s;&|(])(cd|pushd|popd)(\s|$)/;

/** The one place outside a line may write to without reaching anything: output thrown away. */
const NOWHERE = '/dev/null';

/** Where one word of a command line ends. */
const WORD_BREAK = /[\s;&|<>()]+/;

/** False wherever a single action or path could land outside, or the line hides what it runs. */
export function withinSession(
  call: ToolCall,
  containment: Containment | null,
  env: NodeJS.ProcessEnv,
): boolean {
  if (containment?.root === undefined) return false;
  const reaches = reachesOf(call, env);
  if (reaches === null || reaches.length === 0) return false;
  const cwd = call.cwd ?? containment.cwd ?? containment.root;
  // Both sides through their links, so a link inside that points out is read as out.
  const root = realPath(containment.root);
  const place = (target: string): string =>
    realPath(absoluteOf(target, cwd, containment.home));
  const actionsInside = reaches.every(
    (reach) =>
      reach.target === NOWHERE ||
      (reach.target !== undefined &&
        staysInRepository(
          { action: reach.action, target: place(reach.target) },
          { root },
        )),
  );
  if (!actionsInside || call.shell === undefined) return actionsInside;
  return pathWords(call.shell).every((word) => isInside(root, place(word)));
}

/** Null where a command line runs something nothing could see into. */
function reachesOf(call: ToolCall, env: NodeJS.ProcessEnv): Reach[] | null {
  if (call.shell === undefined) return call.requests;
  if (UNREADABLE.test(call.shell)) return null;
  const resolved = resolveShellLine(call.shell, env);
  if (resolved.opaque.length > 0) return null;
  // A command with no path of its own, such as a script run, is kept without one, so it is outside.
  return resolved.actions.flatMap((each) =>
    targetsRuledOn(each).map((target) => ({
      action: each.action,
      ...(target === undefined ? {} : { target }),
    })),
  );
}

/** Every word that names a path, since the resolver keeps only the first a command takes. */
function pathWords(line: string): string[] {
  return line
    .split(WORD_BREAK)
    .map((word) => word.replace(/["']/g, ''))
    .filter((word) => word !== '' && word !== NOWHERE && !word.startsWith('-'))
    .filter((word) => word.includes('/') || word.startsWith('~') || word.startsWith('.'));
}

function absoluteOf(target: string, base: string, home: string | undefined): string {
  if (home !== undefined && (target === '~' || target.startsWith('~/')))
    return join(home, target.slice(1));
  return isAbsolute(target) ? resolve(target) : resolve(base, target);
}

/** The path through every link, as far as it exists; a file about to be made keeps its name. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}
