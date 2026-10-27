import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';
import {
  NOTE_KIND,
  type NoteKind,
  type SessionNote,
  type SessionNotes,
} from './session-notes';

/**
 * What the person told an agent out loud. It is read back first, because speech recognition
 * mishears, and only what they said yes to is kept for the session to pick up at its next pause.
 */

export const SPOKEN_DIR = 'spoken';

/** Long enough to hear it read back and say yes, short enough that a stale one is never sent. */
export const SPOKEN_TTL_MS = 5 * 60 * 1_000;

/** Long enough that a session busy on a long step still hears it, never a message kept for days. */
export const SPOKEN_QUEUE_MS = 2 * 60 * 60 * 1_000;

/** Who a spoken instruction is from, as the agent reads it. */
export const SPOKEN_AUTHOR = 'the person running you, by voice';

export interface SpokenInstruction {
  id: string;
  sessionId: string;
  agent: string;
  /** The instruction as it will reach the agent. */
  message: string;
  /** What the recognizer heard, kept beside the cleaned up words. */
  said?: string;
  proposedAt: string;
  expiresAt: string;
}

export interface SpokenProposal {
  sessionId: string;
  agent: string;
  message: string;
  said?: string;
  at: string;
}

/** Instructions waiting for a yes, and the ones said yes to waiting for their session. */
export class SpokenInstructions implements SessionNotes {
  private readonly proposed: JsonRecordDir<SpokenInstruction>;
  private readonly queued: JsonRecordDir<SpokenInstruction>;

  constructor(
    home: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.proposed = new JsonRecordDir(join(home, MEMNOX_HOME, SPOKEN_DIR, 'proposed'));
    this.queued = new JsonRecordDir(join(home, MEMNOX_HOME, SPOKEN_DIR, 'queued'));
  }

  async propose(input: SpokenProposal): Promise<SpokenInstruction> {
    const instruction: SpokenInstruction = {
      id: `ins_${Date.parse(input.at).toString(36)}_${shortDigest(`${input.sessionId}${input.message}`)}`,
      sessionId: input.sessionId,
      agent: input.agent,
      message: input.message,
      ...(input.said === undefined ? {} : { said: input.said }),
      proposedAt: input.at,
      expiresAt: new Date(Date.parse(input.at) + SPOKEN_TTL_MS).toISOString(),
    };
    await this.proposed.write(instruction.id, instruction);
    return instruction;
  }

  /** Read back and still waiting on a yes, so a brain that lost the thread can still be told. */
  async waiting(moment: string): Promise<SpokenInstruction[]> {
    return (await this.proposed.all()).filter((each) => each.expiresAt > moment);
  }

  /** The proposal said yes to, taken so it is sent once, or null when it is gone or stale. */
  async take(id: string, moment: string): Promise<SpokenInstruction | null> {
    const found = await this.proposed.read(id);
    await this.proposed.remove(id);
    return found === null || found.expiresAt <= moment ? null : found;
  }

  /** Kept for the session to read at its next pause, since it is busy now. */
  async queue(instruction: SpokenInstruction, moment: string): Promise<void> {
    const expiresAt = new Date(Date.parse(moment) + SPOKEN_QUEUE_MS).toISOString();
    await this.queued.write(instruction.id, { ...instruction, expiresAt });
  }

  /** Handed over once: what is queued for this session, removed as it is read. */
  async collect(
    _agent: string,
    sessionId: string,
    kinds?: readonly NoteKind[],
  ): Promise<SessionNote[]> {
    if (kinds !== undefined && !kinds.includes(NOTE_KIND.SPOKEN)) return [];
    const moment = this.now().toISOString();
    const mine = (await this.queued.all()).filter((each) => each.sessionId === sessionId);
    for (const each of mine) await this.queued.remove(each.id);
    return mine
      .filter((each) => each.expiresAt > moment)
      .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt))
      .map((each) => ({
        id: each.id,
        message: each.message,
        issuedBy: SPOKEN_AUTHOR,
        issuedAt: each.proposedAt,
        kind: NOTE_KIND.SPOKEN,
      }));
  }
}
