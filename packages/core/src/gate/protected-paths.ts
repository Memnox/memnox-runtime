/**
 * What governs an agent, as paths: Memnox's own home and rule files, the Claude Code
 * settings that install its hooks, and the record an agent host keeps of its sessions. An agent that could write any of them could turn Memnox
 * off, answer its own questions, or take the hooks out, so these are a person's alone.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Claude Code's settings, which hold the hooks and could switch every one of them off. */
const CLAUDE_SETTINGS = /(^|\/)\.claude\/settings(\.local)?\.json$|(^|\/)\.claude\.json$/;

/**
 * An agent host's own record of its sessions, which the daemon reads a session back from.
 * An agent that rewrote or deleted it would be editing the evidence against it.
 */
const SESSION_RECORDS =
  /(^|\/)\.claude\/projects\/.+\.jsonl$|(^|\/)\.codex\/sessions(\/|$)/;

/** The binaries a hook runs by name, so replacing one would answer for Memnox. */
const MEMNOX_BINARY = /\/(bin|\.bin)\/memnox(-[\w-]+)?$/;

/** Whether a path, as written, names something that governs the agent. */
export function isProtectedPath(target: string): boolean {
  const path = target.replace(/\\/g, '/');
  if (
    path.includes('/.memnox/') ||
    path.endsWith('/.memnox') ||
    path.startsWith('.memnox/')
  )
    return true;
  const name = path.split('/').pop() ?? '';
  if (
    /^memnox\.policies\.(toml|ya?ml|json)$/.test(name) ||
    /\.policies\.toml$/.test(name)
  )
    return true;
  return (
    CLAUDE_SETTINGS.test(path) || MEMNOX_BINARY.test(path) || SESSION_RECORDS.test(path)
  );
}

/**
 * Where a path really lands once every link on the way is followed, so a symlink into
 * `~/.memnox` is the protected path it points at. The part that does not exist yet is
 * joined back on, since a file about to be created has no real path of its own.
 */
export function realPathOf(target: string, cwd: string = process.cwd()): string {
  const absolute = resolve(cwd, target.replace(/^~(?=\/|$)/, homeOf()));
  let existing = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(existing), ...rest.reverse());
    } catch {
      const parent = dirname(existing);
      // Nothing on the way exists, so nothing on the way can be a link.
      if (parent === existing) return absolute;
      rest.push(basename(existing));
      existing = parent;
    }
  }
}

function homeOf(): string {
  return process.env['HOME'] ?? '';
}

/** Whether a path, as written or where it really lands, names something that governs the agent. */
export function touchesProtected(target: string, cwd?: string): boolean {
  return isProtectedPath(target) || isProtectedPath(realPathOf(target, cwd));
}

/**
 * Text in a command line that names a protected place. Only the part a person would type:
 * a determined agent can spell it so no pattern finds it, which is what the kernel wall
 * around its shell is for; this catches the plain spelling before anything runs.
 */
const NAMES_PROTECTED =
  /\.memnox\b|\.policies\.toml\b|\.claude\/settings(\.local)?\.json|\.claude\.json|disableAllHooks|allowUnsandboxedCommands/;

export function namesProtected(line: string): string | null {
  return NAMES_PROTECTED.exec(line)?.[0] ?? null;
}
