/**
 * Where a local Memnox listener is reached: a unix socket under the Memnox home on macOS
 * and Linux, and a named pipe on Windows, where a socket file is not a thing a peer opens.
 */
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';

/** The namespace every Windows named pipe lives in, spelled the way `net.connect` takes it. */
export const PIPE_NAMESPACE = '\\\\.\\pipe\\';

/** The one platform whose listeners are pipes rather than socket files. */
export const WINDOWS_PLATFORM = 'win32';

/** Characters a pipe name keeps from the account name; anything else becomes a hyphen. */
const PIPE_NAME_UNSAFE = /[^A-Za-z0-9._-]/g;

/** The account a home belongs to, read from its last segment in either separator. */
function accountOf(home: string): string {
  const segments = home.split(/[\\/]/).filter((segment) => segment !== '');
  const last = segments[segments.length - 1] ?? 'user';
  return last.replace(PIPE_NAME_UNSAFE, '-');
}

/**
 * `\\.\pipe\memnox-<user>-<digest of home>`. The digest keeps two homes on one machine,
 * a second profile or a test, from answering on each other's pipe.
 */
export function pipeNameFor(home: string, purpose: string): string {
  return `${PIPE_NAMESPACE}${purpose}-${accountOf(home)}-${shortDigest(home)}`;
}

/** Whether an address is a Windows named pipe, which has no file to stat, chmod or remove. */
export function isNamedPipe(address: string): boolean {
  return address.startsWith(PIPE_NAMESPACE);
}

/** True on Windows, the one place listeners are pipes. */
export function usesNamedPipes(platform: NodeJS.Platform): boolean {
  return platform === WINDOWS_PLATFORM;
}

/** The daemon's socket file under the Memnox home, on every platform but Windows. */
export const SOCKET_FILE = 'memnox.sock';

/** What the daemon's pipe is called before the account and home digest. */
const DAEMON_PIPE = 'memnox';

/** The daemon's address: a socket file under the home, or on Windows a pipe named for it. */
export function socketPathFor(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (usesNamedPipes(platform)) return pipeNameFor(home, DAEMON_PIPE);
  return join(home, MEMNOX_HOME, SOCKET_FILE);
}
