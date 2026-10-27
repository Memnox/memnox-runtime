import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { exclusively } from '../store/exclusive';
import { JsonRecordDir } from '../store/json-records';

/**
 * When a person last asked an agent something and when it last finished answering, written by
 * the agent's own hook. The ledger cannot say this: an agent writing a long reply records
 * nothing, so silence there reads as finished when it is still working.
 */
export const TURNS_DIR = 'turns';

/** Enough turns to cover a long working day, never a record that grows without end. */
const MOST_WINDOWS = 60;

/** One turn: from the person's prompt until the agent handed back, open while it works. */
export interface TurnWindow {
  promptAt: string;
  endedAt?: string;
}

export interface SessionTurn {
  sessionId: string;
  agent: string;
  /** The person's last prompt. */
  promptAt?: string;
  /** The agent's last turn ending, when it stopped and handed back to the person. */
  endedAt?: string;
  /** Every recent turn, oldest first, so what changed while it worked can be told apart from the rest. */
  windows?: TurnWindow[];
}

export class SessionTurns {
  private readonly records: JsonRecordDir<SessionTurn>;

  private readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, MEMNOX_HOME, TURNS_DIR);
    this.records = new JsonRecordDir(this.dir);
  }

  async prompted(sessionId: string, agent: string, at: string): Promise<void> {
    await exclusively(this.dir, () => this.recordPrompt(sessionId, agent, at));
  }

  // A prompt and an ending land from two hook processes at once often enough to lose one.
  private async recordPrompt(
    sessionId: string,
    agent: string,
    at: string,
  ): Promise<void> {
    const was = await this.records.read(idFor(sessionId));
    const windows = [...(was?.windows ?? []), { promptAt: at }].slice(-MOST_WINDOWS);
    await this.records.write(idFor(sessionId), {
      ...was,
      sessionId,
      agent,
      promptAt: at,
      windows,
    });
  }

  async ended(sessionId: string, agent: string, at: string): Promise<void> {
    await exclusively(this.dir, () => this.recordEnding(sessionId, agent, at));
  }

  private async recordEnding(
    sessionId: string,
    agent: string,
    at: string,
  ): Promise<void> {
    const was = await this.records.read(idFor(sessionId));
    const windows = [...(was?.windows ?? [])];
    const open = windows[windows.length - 1];
    if (open !== undefined && open.endedAt === undefined) {
      windows[windows.length - 1] = { ...open, endedAt: at };
    }
    await this.records.write(idFor(sessionId), {
      ...was,
      sessionId,
      agent,
      endedAt: at,
      ...(windows.length === 0 ? {} : { windows }),
    });
  }

  async read(sessionId: string): Promise<SessionTurn | null> {
    return this.records.read(idFor(sessionId));
  }

  all(): Promise<SessionTurn[]> {
    return this.records.all();
  }
}

/** A session id as a file name, since an agent's own ids can hold characters a path cannot. */
function idFor(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}
