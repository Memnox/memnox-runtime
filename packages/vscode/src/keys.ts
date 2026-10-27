import { waitingRequest } from './typing';

/**
 * Answering what an agent asks in its terminal, such as whether to trust a folder, by pressing the
 * keys the person chose. The keys come from the request Memnox wrote, never from the link.
 */

/** What a terminal reads for each key the runtime may name, the same as the Mac sends iTerm. */
const SEQUENCES: Readonly<Record<string, string>> = {
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  enter: '\r',
  escape: '\u001b',
  tab: '\t',
  space: ' ',
};

/** Enough to move down a list and pick, never a sentence a key at a time, as the runtime allows. */
const MOST_KEYS = 8;

/** One letter or digit, which is how a numbered or lettered choice is picked. */
const ONE_CHARACTER = /^[a-z0-9]$/;

/** What a terminal reads for the keys named, in order, or null when any word is not a key. */
export function keySequences(said: string): string[] | null {
  const names = said
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word !== '');
  if (names.length === 0 || names.length > MOST_KEYS) return null;
  const sequences = names.map((name) =>
    ONE_CHARACTER.test(name) ? name : SEQUENCES[name],
  );
  return sequences.every((each) => each !== undefined) ? (sequences as string[]) : null;
}

/** The keys to press, or why not: only a press still waiting, for this very terminal. */
export function pressableKeys(
  record: unknown,
  tty: string,
  moment: string,
): { keys: string[] } | { why: string } {
  const waiting = waitingRequest(record, tty, moment, 'press');
  if ('why' in waiting) return waiting;
  const text = waiting.request['text'];
  const keys = typeof text === 'string' ? keySequences(text) : null;
  return keys === null ? { why: 'it names something other than keys' } : { keys };
}
