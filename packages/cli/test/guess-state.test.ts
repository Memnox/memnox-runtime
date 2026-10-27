import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUESS_STATE, guessAllows, noteGuess } from '../src/daemon/guess-state';
import { Speculation } from '../src/daemon/speculation';

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-guess-'));
}

describe('a tool that acts while the brain is only guessing', () => {
  it('goes ahead at once when no guess is in flight', async () => {
    const at = await home();
    expect(await guessAllows(at)).toBe(true);
    await noteGuess(at, GUESS_STATE.ASKED);
    expect(await guessAllows(at)).toBe(true);
  });

  it('waits for the person to finish, then acts once for the guess they said, and never for one they talked past', async () => {
    const adopted = await home();
    await noteGuess(adopted, GUESS_STATE.GUESSING);
    const waiting = guessAllows(adopted);
    await noteGuess(adopted, GUESS_STATE.ADOPTED);
    expect(await waiting).toBe(true);

    const dropped = await home();
    await noteGuess(dropped, GUESS_STATE.GUESSING);
    const refused = guessAllows(dropped);
    await noteGuess(dropped, GUESS_STATE.DROPPED);
    expect(await refused).toBe(false);
  });

  it('never waits on a guess left behind long ago', async () => {
    const at = await home();
    await noteGuess(at, GUESS_STATE.GUESSING, new Date(Date.now() - 60_000));
    expect(await guessAllows(at)).toBe(true);
  });

  it('hears from the speculation where its guess stands', () => {
    const heard: string[] = [];
    const speculation = new Speculation<string>(
      () => undefined,
      (state) => heard.push(state),
    );
    speculation.start('open the', () => new Promise(() => undefined));
    speculation.drop();
    expect(heard).toEqual([GUESS_STATE.GUESSING, GUESS_STATE.DROPPED]);
  });
});
