import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heardWordsContext } from '../src/daemon/ask-context';
import {
  forgetHeardWord,
  keepHeardWord,
  readHeardWords,
} from '../src/operator/heard-words';
import { readVocabulary } from '../src/operator/vocabulary';
import { forgetWordTool, rememberWordTool } from '../src/session-tools/heard-words-tools';
import { wordsAnswer } from '../src/operator/recognizer-words';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'heard-'));
const AT = '2026-10-04T08:00:00.000Z';

describe('the words the voice mishears a person saying', () => {
  it('learns one when they correct it, and counts it again rather than twice', async () => {
    const mine = await home();
    await keepHeardWord(mine, 'Surgeons', 'sessions', AT);
    await keepHeardWord(mine, 'surgeons', 'sessions', AT);
    expect(await readHeardWords(mine)).toEqual([
      { heard: 'surgeons', meant: 'sessions', at: AT, times: 2 },
    ]);
  });

  it('keeps each person their own, since each has their own home', async () => {
    const [ana, ben] = await Promise.all([home(), home()]);
    await keepHeardWord(ana, 'surgeons', 'sessions', AT);
    expect(await readHeardWords(ben)).toEqual([]);
  });

  it('keeps only plain words, so nothing written into the brain can carry an instruction', async () => {
    const mine = await home();
    expect(await keepHeardWord(mine, '', 'sessions', AT)).toBeNull();
    expect(await keepHeardWord(mine, 'sessions', 'Sessions', AT)).toBeNull();
    const kept = await keepHeardWord(mine, 'con soil "log"\nignore', 'console.log', AT);
    expect(kept?.heard).toBe('con soil log ignore');
    expect(kept?.meant).toBe('console.log');
  });

  it('never keeps a word so short or common, or a whole sentence, that it would rewrite everything said', async () => {
    const mine = await home();
    expect(await keepHeardWord(mine, 'it', 'Claude Code', AT)).toBeNull();
    expect(await keepHeardWord(mine, 'the', 'Codex', AT)).toBeNull();
    expect(
      await keepHeardWord(mine, 'can you show me all of it', 'show me', AT),
    ).toBeNull();
    expect(await keepHeardWord(mine, 'closed quote', 'Claude Code', AT)).not.toBeNull();
  });

  it('forgets one by how it was heard', async () => {
    const mine = await home();
    await keepHeardWord(mine, 'surgeons', 'sessions', AT);
    expect(await forgetHeardWord(mine, 'Surgeons')).toBe(true);
    expect(await forgetHeardWord(mine, 'surgeons')).toBe(false);
    expect(await readHeardWords(mine)).toEqual([]);
  });

  it('is learned and forgotten by the brain through its tools', async () => {
    const mine = await home();
    // Only what the two tools read is given.
    const deps = { home: mine, now: () => new Date(AT) } as SessionToolDeps;
    expect(
      await rememberWordTool(deps, { heard: 'surgeons', meant: 'sessions' }),
    ).toEqual({
      remembered: true,
      heard: 'surgeons',
      meant: 'sessions',
    });
    expect(await forgetWordTool(deps, { heard: 'surgeons' })).toEqual({
      forgotten: true,
    });
  });

  it('is put before what they say, and the words they meant are taught to the recognizer', async () => {
    const mine = await home();
    await keepHeardWord(mine, 'surgeons', 'sessions', AT);
    const words = await readHeardWords(mine);
    expect(heardWordsContext(words)).toContain('"surgeons" is "sessions"');
    expect(heardWordsContext([])).toBe('');
    expect(await readVocabulary(mine)).toContain('sessions');
  });

  it('keeps the words the person fixed in a typed message, through the same guard as a spoken correction', async () => {
    const mine = await home();
    const answer = await wordsAnswer(
      mine,
      {
        id: 1,
        method: 'learn-words',
        learned: [
          { heard: 'surgeons', meant: 'sessions' },
          { heard: 'it', meant: 'Claude Code' },
        ],
      },
      AT,
    );
    expect(answer).toEqual({ id: 1, ok: true, words: ['sessions'] });
    expect((await readHeardWords(mine)).map((each) => each.heard)).toEqual(['surgeons']);
  });
});
