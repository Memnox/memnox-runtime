import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { processAlive } from '../coordination/lease-store';
import { readJsonFile, writeJsonFile } from '../store/json-records';

/**
 * Whether the Mac voice is listening right now, kept by the daemon while the app is subscribed.
 * A held question waits a little for a spoken answer when it is, because a picker on screen
 * is something only a click can close, and a yes said out loud would otherwise go nowhere.
 */

const VOICE_PRESENCE_FILE = 'voice-listening.json';

interface VoicePresence {
  /** The daemon holding the subscription, so a daemon that died is not taken for a voice. */
  pid: number;
  since: string;
}

function presencePath(home: string): string {
  return join(home, MEMNOX_HOME, VOICE_PRESENCE_FILE);
}

export async function markVoiceListening(
  home: string,
  pid: number,
  since: string,
): Promise<void> {
  const presence: VoicePresence = { pid, since };
  await writeJsonFile(presencePath(home), presence);
}

export async function clearVoiceListening(home: string): Promise<void> {
  await rm(presencePath(home), { force: true });
}

/** Listening only while the daemon that said so is still running. */
export async function voiceListening(
  home: string,
  alive: (pid: number) => boolean = processAlive,
): Promise<boolean> {
  const presence = await readJsonFile<VoicePresence>(presencePath(home));
  return typeof presence?.pid === 'number' && alive(presence.pid);
}
