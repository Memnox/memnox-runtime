import { execFileSync } from 'node:child_process';
import type { SessionHost } from '@memnox/core';

/**
 * Where a session runs now rather than where it ran when it began: a tab closed or reused since
 * would otherwise be typed into, or brought forward, for a session that is no longer there.
 */

/** The host with its terminal as it is now, or null when its process has ended. */
export function liveHost(host: SessionHost): SessionHost | null {
  if (!processAlive(host.pid)) return null;
  // A panel session's process may hold a terminal it inherited, which is never where it is typed into.
  if (host.panel === true) return host;
  const tty = ttyOf(host.pid);
  if (tty === null) {
    const { tty: _gone, ...rest } = host;
    return host.tty === undefined ? host : rest;
  }
  return { ...host, tty };
}

/** Signal zero asks whether the process exists without touching it. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Somebody else's process is still a process.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What `ps` prints for a process with no terminal: `??` on macOS, `?` on Linux. */
const NO_TERMINAL = new Set(['', '?', '??']);

/** The controlling terminal of a process, as `ps` names it, or null for one with none. */
function ttyOf(pid: number): string | null {
  try {
    const tty = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return NO_TERMINAL.has(tty) ? null : tty;
  } catch {
    // Gone between the two questions, or ps refused: no terminal to name.
    return null;
  }
}
