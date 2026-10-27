import { createHmac, randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { redactSecrets } from '../domain/redact';

/**
 * What a file path or a command line becomes before it leaves this machine, when the person
 * chose not to send them as written: a keyed hash, so the workspace can still tell that two
 * actions touched the same file and can never read or guess which file it was.
 */

const KEY_FILE = 'upload-key';
const KEY_BYTES = 32;
/** Long enough that two different paths never meet in a workspace, short enough to read. */
const HASH_CHARS = 24;
export const HASHED_PREFIX = 'h_';

/** Namespaces whose target is a path or a command somebody typed, which is what can name a customer. */
const PATH_NAMESPACES: readonly string[] = ['file', 'filesystem', 'shell'];

export function carriesPath(operation: string): boolean {
  return PATH_NAMESPACES.includes(operation.split('.')[0] ?? '');
}

/**
 * Made once per machine and never sent anywhere. Held by the machine rather than derived
 * from the workspace, since a key the workspace knows would let it hash a dictionary of paths.
 */
export async function uploadKeyOf(home: string): Promise<Buffer> {
  const path = join(home, MEMNOX_HOME, KEY_FILE);
  try {
    return Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
  } catch {
    await mkdir(join(home, MEMNOX_HOME), { recursive: true, mode: 0o700 });
    // Written whole beside it, then linked in, so a reader never sees a half written key.
    const draft = `${path}.${process.pid}.${randomBytes(4).toString('hex')}`;
    await writeFile(draft, randomBytes(KEY_BYTES).toString('base64'), { mode: 0o600 });
    try {
      await link(draft, path);
    } catch (err) {
      // Another process linked its key first, and that one is the machine's.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    } finally {
      await rm(draft, { force: true });
    }
    return Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
  }
}

export function hashedRef(key: Buffer, text: string): string {
  const digest = createHmac('sha256', key).update(text).digest('hex');
  return `${HASHED_PREFIX}${digest.slice(0, HASH_CHARS)}`;
}

/**
 * The target as the workspace receives it: a path or command hashed when the key is given,
 * everything else masked for secrets and sent, since an MCP tool or a host names no customer.
 */
export function uploadedRef(
  operation: string,
  target: string,
  key: Buffer | null,
): string {
  if (key !== null && carriesPath(operation)) return hashedRef(key, target);
  return redactSecrets(target);
}
