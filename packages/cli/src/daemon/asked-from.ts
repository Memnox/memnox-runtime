import { join } from 'node:path';
import { MEMNOX_HOME, readJsonFile, writeJsonFile } from '@memnox/core';

/**
 * Which device the question the brain is answering came from, since the brain runs its tools in
 * its own process and a tool that starts a session must refuse when the person spoke through a phone.
 */

const ASKED_FROM_FILE = join('voice', 'asked-from.json');

/** Longer than any one turn; a phone's question older than this was left behind, not being answered. */
const ASK_STALE_MS = 10 * 60 * 1_000;

interface Kept {
  /** The paired phone that asked, absent when the Mac did. */
  deviceId?: string;
  at: string;
}

/** Kept as each question begins, from the device the daemon proved rather than anything a client wrote. */
export async function noteAskedFrom(
  home: string,
  deviceId: string | undefined,
  at: string,
): Promise<void> {
  const kept: Kept = { at, ...(deviceId === undefined ? {} : { deviceId }) };
  await writeJsonFile(join(home, MEMNOX_HOME, ASKED_FROM_FILE), kept);
}

/** Whether the question being answered came from a phone, false when nothing was noted or it is old. */
export async function askedFromPhone(home: string, now: Date): Promise<boolean> {
  const kept = await readJsonFile<Kept>(join(home, MEMNOX_HOME, ASKED_FROM_FILE));
  if (typeof kept?.deviceId !== 'string' || typeof kept.at !== 'string') return false;
  return now.getTime() - Date.parse(kept.at) < ASK_STALE_MS;
}
