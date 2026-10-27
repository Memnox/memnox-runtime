import { minutesToMs, readJsonFile, writeJsonFile } from '@memnox/core';
import { conversationPath } from '../memnox-paths';

/**
 * Which brain conversation the voice is in, so "and the other one?" a few minutes later
 * resumes it with its context rather than starting a stranger.
 */

/** A working afternoon with gaps in it, so it still knows the session from before lunch; tomorrow starts fresh. */
const CONVERSATION_IDLE_MS = minutesToMs(180);

/** Every turn rereads the whole history, so past this many the next answer starts fresh, with recall carrying the thread. */
export const MOST_CONVERSATION_TURNS = 40;

interface Conversation {
  brain: string;
  sessionId: string;
  lastAt: string;
  /** Which instructions and model it began under, since history written under old ones teaches the old way. */
  version?: string;
  /** Questions asked in it, absent on records written before it was counted. */
  turns?: number;
}

/** A conversation worth resuming, and how many questions it has already carried. */
export interface Resumable {
  sessionId: string;
  turns: number;
}

export class Conversations {
  constructor(private readonly home: string) {}

  /** The conversation to resume, or null when there is none for this brain or it went quiet. */
  async resumable(brain: string, now: Date, version: string): Promise<Resumable | null> {
    const kept = await readJsonFile<Conversation>(conversationPath(this.home));
    if (kept === null || kept.brain !== brain || kept.version !== version) return null;
    const turns = kept.turns ?? 0;
    if (turns >= MOST_CONVERSATION_TURNS) return null;
    const idle = now.getTime() - Date.parse(kept.lastAt);
    return idle < CONVERSATION_IDLE_MS ? { sessionId: kept.sessionId, turns } : null;
  }

  async keep(
    brain: string,
    sessionId: string,
    now: Date,
    version: string,
    turns: number,
  ): Promise<void> {
    const kept: Conversation = {
      brain,
      sessionId,
      lastAt: now.toISOString(),
      version,
      turns,
    };
    await writeJsonFile(conversationPath(this.home), kept);
  }
}
