import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { MEMNOX_HOME, readJsonFile, writeJsonFile } from '@memnox/core';

/**
 * Where the answer the brain is working on stands, since the brain runs a tool the moment it calls
 * it, before the daemon can stop a guess made while the person paused, which must never act.
 */

const GUESS_FILE = join('voice', 'guess.json');

export const GUESS_STATE = {
  GUESSING: 'guessing',
  ADOPTED: 'adopted',
  DROPPED: 'dropped',
  ASKED: 'asked',
} as const;

export type GuessState = (typeof GUESS_STATE)[keyof typeof GUESS_STATE];

interface Kept {
  state: GuessState;
  at: string;
}

/** Longer than anybody pauses mid sentence; a guess older than this was left behind, not waiting. */
const GUESS_STALE_MS = 30_000;
/** Quick enough that an adopted guess acts the moment the person finishes. */
const GUESS_POLL_MS = 50;

export async function noteGuess(
  home: string,
  state: GuessState,
  at: Date = new Date(),
): Promise<void> {
  await writeJsonFile(join(home, MEMNOX_HOME, GUESS_FILE), {
    state,
    at: at.toISOString(),
  });
}

async function readGuess(home: string): Promise<Kept | null> {
  const kept = await readJsonFile<Kept>(join(home, MEMNOX_HOME, GUESS_FILE));
  return typeof kept?.state === 'string' && typeof kept.at === 'string' ? kept : null;
}

/**
 * Whether an action may go ahead now: at once outside a guess, and inside one only once the person
 * finished saying the same words, waiting until they do; false when the guess was dropped, or left.
 */
export async function guessAllows(
  home: string,
  now: () => number = Date.now,
): Promise<boolean> {
  const first = await readGuess(home);
  if (first?.state !== GUESS_STATE.GUESSING) return true;
  const until = Date.parse(first.at) + GUESS_STALE_MS;
  if (now() >= until) return true;
  while (now() < until) {
    await sleep(GUESS_POLL_MS);
    const state = (await readGuess(home))?.state;
    if (state !== GUESS_STATE.GUESSING) return state === GUESS_STATE.ADOPTED;
  }
  return false;
}
