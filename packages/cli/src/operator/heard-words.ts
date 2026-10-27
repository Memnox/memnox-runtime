import { join } from 'node:path';
import { MEMNOX_HOME, readJsonFile, writeJsonFile } from '@memnox/core';

/**
 * The words the recognizer gets wrong for this person, learned when they correct one, such as
 * "surgeons" for sessions. It lives in their own home, so each person on a shared Mac keeps their
 * own list, and it never goes to the workspace: how somebody speaks is theirs alone.
 */

const HEARD_FILE = join('voice', 'heard-words.json');

/** Enough for every word a voice trips on, never a list that grows without end. */
const MOST_WORDS = 200;
/** A word or a short phrase; anything longer is not a mishearing. */
const MOST_CHARS = 40;

export interface HeardWord {
  /** What the recognizer wrote, lowercased. */
  heard: string;
  /** What the person meant. */
  meant: string;
  /** When it was last learned or confirmed. */
  at: string;
  /** How many times it was corrected, so the ones that keep happening outlive the rest. */
  times: number;
}

/** Shorter than this is a sound, not a word worth learning, and too easy to hear anywhere. */
const LEAST_HEARD_CHARS = 3;
/** More words than this is a sentence they rewrote, not one word misheard. */
const MOST_HEARD_WORDS = 4;

/**
 * Words in nearly every sentence: learning one would rewrite everything they say, so a correction
 * of one is taken for that sentence only and never kept.
 */
const COMMON: ReadonlySet<string> = new Set([
  'the',
  'and',
  'but',
  'for',
  'you',
  'your',
  'are',
  'was',
  'can',
  'could',
  'would',
  'will',
  'not',
  'all',
  'any',
  'this',
  'that',
  'these',
  'those',
  'with',
  'what',
  'which',
  'when',
  'where',
  'how',
  'why',
  'who',
  'its',
  "it's",
  'have',
  'has',
  'had',
  'did',
  'does',
  'one',
  'two',
  'yes',
  'okay',
  'there',
  'their',
  'then',
  'than',
  'them',
  'they',
  'from',
  'about',
  'just',
  'now',
  'please',
  'show',
  'open',
  'tell',
  'ask',
  'make',
  'run',
  'stop',
  'start',
]);

/** Whether a heard word is safe to keep: long enough, a word or a few, and not one every sentence has. */
function learnable(heard: string): boolean {
  const words = heard.split(' ');
  return (
    heard.length >= LEAST_HEARD_CHARS &&
    words.length <= MOST_HEARD_WORDS &&
    !(words.length === 1 && COMMON.has(heard))
  );
}

/** Letters, digits and the marks a name or a command uses; anything else could carry an instruction. */
function plain(text: string): string {
  return text
    .replace(/[^\p{L}\p{M}\p{N}' .\-_/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MOST_CHARS);
}

export async function readHeardWords(home: string): Promise<HeardWord[]> {
  const kept = await readJsonFile<{ words?: HeardWord[] }>(
    join(home, MEMNOX_HOME, HEARD_FILE),
  );
  return (kept?.words ?? []).filter(
    (each) => typeof each.heard === 'string' && typeof each.meant === 'string',
  );
}

/** Learns one, or counts it again when it is already known; null when either side is not a word. */
export async function keepHeardWord(
  home: string,
  heard: string,
  meant: string,
  at: string,
): Promise<HeardWord | null> {
  const word = { heard: plain(heard).toLowerCase(), meant: plain(meant) };
  if (
    word.meant === '' ||
    word.heard === word.meant.toLowerCase() ||
    !learnable(word.heard)
  )
    return null;
  const words = await readHeardWords(home);
  const was = words.find((each) => each.heard === word.heard);
  const kept: HeardWord = { ...word, at, times: (was?.times ?? 0) + 1 };
  const rest = words.filter((each) => each.heard !== word.heard);
  // The least corrected and oldest go first once the list is full.
  const next = [...rest, kept]
    .sort((a, b) => b.times - a.times || b.at.localeCompare(a.at))
    .slice(0, MOST_WORDS);
  await writeJsonFile(join(home, MEMNOX_HOME, HEARD_FILE), { words: next });
  return kept;
}

/** Forgets what was learned for a heard word; false when there was nothing to forget. */
export async function forgetHeardWord(home: string, heard: string): Promise<boolean> {
  const words = await readHeardWords(home);
  const key = plain(heard).toLowerCase();
  const next = words.filter((each) => each.heard !== key);
  if (next.length === words.length) return false;
  await writeJsonFile(join(home, MEMNOX_HOME, HEARD_FILE), { words: next });
  return true;
}
