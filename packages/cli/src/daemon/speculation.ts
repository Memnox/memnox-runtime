import type { DaemonAskChunk } from '@memnox/core';
import { BRAIN_CHUNK } from '../operator/brain';
import { OPERATOR_TOOLS } from '../session-tools/operator-tools';
import { GUESS_STATE, type GuessState } from './guess-state';

/**
 * An answer started while the person pauses, said only once an ask brings the same words, and
 * stopped the moment the brain reaches for anything but a read, so it never acts on half a sentence.
 */

/** Tools that only read, by bare name, which a guess may run since running them changes nothing. */
const READS: ReadonlySet<string> = new Set(
  OPERATOR_TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name),
);

/** Said ahead of the next question when a guess reached the brain and was not what they meant. */
export const OVERTAKEN_NOTE =
  '[Memnox, not the person] Your last answer was a guess made while they paused, and none of it was said or done. Here is what they said in full; answer only this.';

/** The words alone, so the final transcript's capitals and full stop still match the guess. */
export function sameWords(a: string, b: string): boolean {
  const words = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return words(a) !== '' && words(a) === words(b);
}

/** A tool call that does something other than read, which a guess must never make. */
export function acts(chunk: DaemonAskChunk): boolean {
  if (chunk.kind !== BRAIN_CHUNK.TOOL) return false;
  const name = (chunk.tool ?? '').split('__').pop() ?? '';
  return !READS.has(name);
}

interface Guess<R> {
  said: string;
  held: DaemonAskChunk[];
  /** Where its chunks go once it is adopted; until then they are held. */
  forward: ((chunk: DaemonAskChunk) => void) | null;
  /** It reached the brain, so a dropped guess leaves words in the conversation to disown. */
  started: boolean;
  /** Overtaken or stopped at a tool that acts: nothing more of it is wanted. */
  dropped: boolean;
  /** Its turn was stopped by something other than a drop, so adopting it would answer with nothing. */
  stopped: boolean;
  finished: boolean;
  done: Promise<R | undefined>;
}

/** What `run` is handed: where chunks go, and whether the turn is still wanted as it starts. */
export interface GuessSeams {
  send: (chunk: DaemonAskChunk) => void;
  wanted: () => boolean;
}

export class Speculation<R> {
  private guess: Guess<R> | null = null;
  /** A dropped guess reached the brain, so the next question says it was not theirs. */
  private overtaken = false;

  /**
   * @param stop stops the brain's turn in flight, which is the guess's when it has started.
   * @param noted hears where the guess stands, so a tool that acts waits on it rather than running in a guess.
   */
  constructor(
    private readonly stop: () => void,
    private readonly noted: (state: GuessState) => void = () => undefined,
  ) {}

  /** Starts a guess at these words, unless one for the same words is already going. */
  start(said: string, run: (seams: GuessSeams) => Promise<R>): void {
    if (this.guess !== null && !this.guess.dropped && sameWords(this.guess.said, said))
      return;
    this.drop();
    this.noted(GUESS_STATE.GUESSING);
    const guess: Guess<R> = {
      said,
      held: [],
      forward: null,
      started: false,
      dropped: false,
      stopped: false,
      finished: false,
      done: Promise.resolve(undefined),
    };
    const send = (chunk: DaemonAskChunk): void => {
      if (guess.forward !== null) return guess.forward(chunk);
      if (guess.dropped) return;
      if (chunk.kind === BRAIN_CHUNK.CANCELLED) guess.stopped = true;
      if (acts(chunk)) {
        this.dropGuess(guess);
        return;
      }
      guess.held.push(chunk);
    };
    const wanted = (): boolean => {
      if (guess.dropped) return false;
      guess.started = true;
      return true;
    };
    guess.done = run({ send, wanted })
      .catch((): undefined => undefined)
      .finally(() => {
        guess.finished = true;
      });
    this.guess = guess;
  }

  /**
   * The person finished with these words. When the guess was at them, what it held is passed on
   * now and the rest as it comes, and this resolves with its answer once it is over; null when
   * there was no guess at these words, and the question is asked afresh.
   */
  async adopt(
    said: string,
    forward: (chunk: DaemonAskChunk) => void,
  ): Promise<{ answer: R | undefined } | null> {
    const guess = this.guess;
    if (guess === null || guess.dropped || !sameWords(guess.said, said)) {
      this.drop();
      // Only a guess the brain is on is waited out; one still gathering its context is skipped when its moment comes.
      if (guess !== null && guess.started) await guess.done;
      return null;
    }
    // A guess cut short holds only its end, and adopting that left the person with silence, so it is asked afresh.
    if (guess.stopped) {
      this.guess = null;
      if (guess.started) this.overtaken = true;
      await guess.done;
      return null;
    }
    this.guess = null;
    this.noted(GUESS_STATE.ADOPTED);
    for (const chunk of guess.held.splice(0)) forward(chunk);
    guess.forward = forward;
    return { answer: await guess.done };
  }

  /** Whether the next real question must say the guess before it was not what they meant. */
  takeOvertaken(): boolean {
    const was = this.overtaken;
    this.overtaken = false;
    return was;
  }

  /** Drops whatever guess is going, as the person said something else or nothing more is wanted. */
  drop(): void {
    if (this.guess !== null) this.dropGuess(this.guess);
    this.guess = null;
  }

  private dropGuess(guess: Guess<R>): void {
    if (guess.dropped || guess.forward !== null) return;
    guess.dropped = true;
    this.noted(GUESS_STATE.DROPPED);
    if (guess.started) this.overtaken = true;
    // Only a guess the brain is on is stopped there; a queued one is skipped when its moment comes.
    if (guess.started && !guess.finished) this.stop();
  }
}
