/**
 * Which integrated terminal a session runs in, found by the terminal device its shell holds,
 * since VS Code names a terminal only by the pid of the shell it started.
 */

/** A terminal as far as matching needs it: the pid of its shell, once VS Code knows it. */
interface ShellTerminal<T> {
  terminal: T;
  processId: PromiseLike<number | undefined>;
}

/** `ttys013`, `/dev/ttys013` and `s013` name one device, so all are compared as `ttys013`. */
export function deviceName(tty: string): string {
  const bare = tty.trim().replace(/^\/dev\//, '');
  return bare.startsWith('tty') ? bare : `tty${bare}`;
}

/** Long enough for VS Code to report a started shell's pid, short enough that a window still answers in time. */
const PID_WAIT_MS = 1_000;

/**
 * The first terminal whose shell holds the device, or null where none of them does. Every terminal is
 * asked at once and each for a bounded time, since VS Code can leave a terminal's pid unreported for
 * good, and waiting on one of those in turn hid every terminal after it, the session's own included.
 */
export async function terminalOn<T>(
  tty: string,
  terminals: readonly ShellTerminal<T>[],
  deviceOf: (pid: number) => Promise<string | null>,
  waitMs: number = PID_WAIT_MS,
): Promise<T | null> {
  const wanted = deviceName(tty);
  const devices = await Promise.all(
    terminals.map(async (each) => {
      const pid = await within(each.processId, waitMs);
      return pid === undefined ? null : deviceOf(pid).catch(() => null);
    }),
  );
  const index = devices.findIndex(
    (device) => device !== null && deviceName(device) === wanted,
  );
  return index === -1 ? null : (terminals[index]?.terminal ?? null);
}

/** The pid once VS Code reports it, or undefined when it does not within the wait or fails to. */
function within(
  pid: PromiseLike<number | undefined>,
  waitMs: number,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), waitMs);
    const settle = (value: number | undefined): void => {
      clearTimeout(timer);
      resolve(value);
    };
    Promise.resolve(pid).then(settle, () => settle(undefined));
  });
}

/** A device as the Mac sends it: only a real terminal name, since it arrives in a link anyone can open. */
export function deviceFromLink(query: string): string | null {
  const tty = new URLSearchParams(query).get('tty');
  if (tty === null) return null;
  return /^(\/dev\/)?ttys?[0-9]+$/.test(tty) ? tty : null;
}
