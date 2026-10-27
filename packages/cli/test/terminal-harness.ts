import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** How long one process on a terminal is kept, longer than any test that reads it. */
const HELD_FOR = '30';
const LOOK_EVERY_MS = 50;
const LOOKS = 40;

/** `script` takes its command after the log file on macOS and through `-c` on Linux. */
function scriptArgs(): string[] {
  return process.platform === 'darwin'
    ? ['-q', '/dev/null', 'sleep', HELD_FOR]
    : ['-q', '-c', `sleep ${HELD_FOR}`, '/dev/null'];
}

/** The first child of a process, or null while it has none; pgrep exits 1 when nothing matches. */
function firstChild(pid: number): string | null {
  try {
    const child = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .trim()
      .split('\n')[0];
    return child === undefined || child === '' ? null : child;
  } catch {
    return null;
  }
}

let held: ChildProcess | null = null;

/** A process on a terminal of its own, as an agent in a pane or a tab is, so its device is read for real. */
export async function onATerminal(): Promise<{ pid: number; tty: string }> {
  held = spawn('script', scriptArgs(), { stdio: 'ignore' });
  for (let look = 0; look < LOOKS; look += 1) {
    await sleep(LOOK_EVERY_MS);
    const child = held.pid === undefined ? null : firstChild(held.pid);
    if (child === null) continue;
    const tty = execFileSync('ps', ['-o', 'tty=', '-p', child], {
      encoding: 'utf8',
    }).trim();
    return { pid: Number(child), tty };
  }
  throw new Error('the process on a terminal never started');
}

/** Ends the process on a terminal, for an `afterEach`. */
export function releaseTerminal(): void {
  held?.kill();
  held = null;
}
