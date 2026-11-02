import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_QUESTIONS_DIR,
  DEVICES_FILE,
  DISPLAYS_DIR,
  MEMNOX_HOME,
  PAUSE_DIR,
  PENDING_DIR,
  POSTS_DIR,
  PROPOSALS_DIR,
  SESSION_HOSTS_DIR,
  TURNS_DIR,
} from '@memnox/core';

/**
 * Whether what is waiting on a person needs reading again. A full read walks every store and opens the ledger, and
 * twice a second all day that was most of the daemon's idle CPU; a stat of the folders it reads costs almost nothing.
 */

/** Everything the waiting feed reads; each store writes by rename, so a write moves its folder's time. */
const WATCHED = [
  PENDING_DIR,
  DISPLAYS_DIR,
  AGENT_QUESTIONS_DIR,
  PROPOSALS_DIR,
  PAUSE_DIR,
  POSTS_DIR,
  SESSION_HOSTS_DIR,
  TURNS_DIR,
  DEVICES_FILE,
  join('agents', 'names.json'),
];

/** Read whole this often whatever moved, for what turns on the clock alone, such as a call that expired. */
const FULL_READ_EVERY_MS = 3_000;

export class FeedGate {
  private readonly paths: string[];
  private seen: string | null = null;
  private lastFull = Number.NEGATIVE_INFINITY;
  private listeners = -1;

  constructor(
    home: string,
    private readonly fullEveryMs: number = FULL_READ_EVERY_MS,
    private readonly modifiedAt: (path: string) => Promise<number> = modifiedTime,
  ) {
    this.paths = WATCHED.map((each) => join(home, MEMNOX_HOME, each));
  }

  /** The read, only when it is due, timed by the real clock so a test's frozen one never holds it back. */
  async whenMoved(listeners: number, read: () => Promise<void>): Promise<void> {
    if (await this.due(Date.now(), listeners)) await read();
  }

  /** Due when a folder moved, when somebody started or stopped listening, or when the full read is due anyway. */
  async due(nowMs: number, listeners: number): Promise<boolean> {
    const times = await Promise.all(this.paths.map((path) => this.modifiedAt(path)));
    const now = times.join(',');
    const moved = now !== this.seen || listeners !== this.listeners;
    if (!moved && nowMs - this.lastFull < this.fullEveryMs) return false;
    this.seen = now;
    this.listeners = listeners;
    this.lastFull = nowMs;
    return true;
  }
}

/** A missing folder reads as its own time, so its first write still counts as a move. */
function modifiedTime(path: string): Promise<number> {
  return stat(path).then(
    (each) => each.mtimeMs,
    () => -1,
  );
}
