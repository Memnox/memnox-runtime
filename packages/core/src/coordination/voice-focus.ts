import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';

/**
 * The session the person last asked the voice about: opened, told something, watched, walked
 * through or put back, or the one it just started for them. Kept on disk, so "it" and "that
 * one" mean the same session on the next question, and the next conversation, as they did here.
 */

export const VOICE_FOCUS_FILE = 'voice-focus.json';

export interface VoiceFocus {
  /** The session, when it was one already running. */
  sessionId?: string;
  /** For a session just started, which has no id until its agent first acts: where it was started. */
  repository?: string;
  agent?: string;
  /** What was done with it, in a word: opened, told, watched, walked, rewound, started. */
  why: string;
  at: string;
}

export class VoiceFocusStore {
  private readonly path: string;

  constructor(home: string) {
    this.path = join(home, MEMNOX_HOME, VOICE_FOCUS_FILE);
  }

  read(): Promise<VoiceFocus | null> {
    return readJsonFile<VoiceFocus>(this.path);
  }

  async set(focus: VoiceFocus): Promise<void> {
    await writeJsonFile(this.path, focus);
  }
}
