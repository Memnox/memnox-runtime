import { DAEMON_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { keepHeardWord } from './heard-words';
import { commandCatalogue } from './own-brain';
import { commandWords, readVocabulary } from './vocabulary';

/**
 * What the Mac's recognizer is taught: the names on this machine, and every memnox command,
 * which the brain reads whole from the catalogue instead.
 */
async function recognizerWords(home: string): Promise<string[]> {
  const [names, catalogue] = await Promise.all([
    readVocabulary(home),
    commandCatalogue().catch(() => ''),
  ]);
  return [...new Set([...names, ...commandWords(catalogue)])];
}

/** Few enough for one edit to a typed message; more is a rewrite, not a word or two misheard. */
const MOST_LEARNED_AT_ONCE = 5;

export function isWordsMethod(method: string): boolean {
  return method === DAEMON_METHOD.VOCABULARY || method === DAEMON_METHOD.LEARN_WORDS;
}

/**
 * The words to listen for, or the words the person fixed in what the Mac typed for them, each kept
 * only where the heard words list would keep a spoken correction.
 */
export async function wordsAnswer(
  home: string,
  request: DaemonRequest,
  now: string,
): Promise<DaemonResponse> {
  if (request.method === DAEMON_METHOD.VOCABULARY) {
    return { id: request.id, ok: true, words: await recognizerWords(home) };
  }
  const learned = (request.learned ?? []).slice(0, MOST_LEARNED_AT_ONCE);
  const kept = [];
  for (const each of learned) {
    if (typeof each.heard !== 'string' || typeof each.meant !== 'string') continue;
    const word = await keepHeardWord(home, each.heard, each.meant, now);
    if (word !== null) kept.push(word.meant);
  }
  return { id: request.id, ok: true, words: kept };
}
