/**
 * The voice's brain: the person's own agent CLI, logged in as they already are, given the
 * operator's tools and nothing else. Memnox never holds a model credential of its own.
 */

export const BRAIN_CHUNK = {
  /** Words to say, in the order they arrive, so speech can start on the first sentence. */
  TEXT: 'text',
  /** The brain is reading the machine through a tool, which the orb shows as thinking. */
  TOOL: 'tool',
  /** The turn is over. */
  DONE: 'done',
  /** The person's plan ran out, which is said out loud rather than failed silently. */
  LIMITED: 'limited',
  FAILED: 'failed',
  /** The person stopped it, usually by talking over it. Not a failure, and said as none. */
  CANCELLED: 'cancelled',
} as const;

export type BrainChunkKind = (typeof BRAIN_CHUNK)[keyof typeof BRAIN_CHUNK];

export interface BrainChunk {
  kind: BrainChunkKind;
  /** The words, on TEXT; what went wrong, on LIMITED and FAILED. */
  text?: string;
  /** The tool being called, on TOOL. */
  tool?: string;
}

export interface Brain {
  /** The CLI it runs, as a person would name it. */
  readonly name: string;
  /** One turn of the conversation, answered as it streams. */
  ask(said: string): AsyncIterable<BrainChunk>;
  /** Ends the warm process; the next ask resumes the same conversation. */
  close(): void;
  /** Stops the turn in flight, which then ends with CANCELLED; the conversation survives it. */
  cancel(): void;
  /** Starts the process before the question arrives, so the first answer skips the cold start. */
  warm(): Promise<void>;
}
