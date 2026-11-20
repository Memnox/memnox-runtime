/**
 * Written whole, or not at all, through a rename, because `writeFile` truncates first and a
 * reader arriving mid write would see an empty file.
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const OWNER_ONLY = 0o600;

// Counted per write rather than per process, so two writers never share a scratch file.
let writes = 0;

/** What Windows answers while another handle has the path open or its delete is pending, which passes once it is closed. */
export const WINDOWS_BUSY_CODES: readonly string[] = ['EPERM', 'EACCES', 'EBUSY'];
const RENAME_TRIES = 10;
const RENAME_BACKOFF_MS = 15;

export async function writeAtomic(path: string, contents: string): Promise<void> {
  writes += 1;
  const scratch = `${path}.${process.pid}.${writes}.tmp`;
  await writeFile(scratch, contents, { encoding: 'utf8', mode: OWNER_ONLY });
  try {
    await renameWhenFree(scratch, path);
  } catch (err) {
    await rm(scratch, { force: true });
    throw err;
  }
}

/**
 * A rename over a file a reader or a virus scanner holds open fails on Windows for a moment,
 * so it is tried again a bounded number of times there; elsewhere the first answer stands.
 */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let tried = 1; ; tried += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const busy =
        process.platform === 'win32' && WINDOWS_BUSY_CODES.includes(codeOf(err));
      if (!busy || tried >= RENAME_TRIES) throw err;
      await sleep(RENAME_BACKOFF_MS * tried);
    }
  }
}

/** The errno code of a failed fs call, or empty when the error carries none. */
export function codeOf(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
}

/** The same, for a record that is stored as pretty JSON. Which is all of them. */
export async function writeJsonAtomic(path: string, record: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** Whether a read failed only because the file is not there yet, which callers treat as empty. */
export function isMissingFile(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
  );
}
