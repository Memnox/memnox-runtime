import { describe, expect, it } from 'vitest';
import type { DaemonAskChunk } from '@memnox/core';
import { BRAIN_CHUNK } from '../src/operator/brain';
import { acts, sameWords, Speculation, type GuessSeams } from '../src/daemon/speculation';

const text = (words: string): DaemonAskChunk => ({ kind: BRAIN_CHUNK.TEXT, text: words });
const tool = (name: string): DaemonAskChunk => ({
  kind: BRAIN_CHUNK.TOOL,
  tool: `mcp__memnox-operator__${name}`,
});

/** A turn the test drives by hand: it starts when asked, then sends what it is told to. */
function manualTurn(): {
  run: (seams: GuessSeams) => Promise<string>;
  begin: () => boolean;
  send: (chunk: DaemonAskChunk) => void;
  end: (answer: string) => void;
} {
  let seams: GuessSeams | null = null;
  let finish: (answer: string) => void = () => undefined;
  return {
    run: (given) => {
      seams = given;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    begin: () => seams?.wanted() ?? false,
    send: (chunk) => seams?.send(chunk),
    end: (answer) => finish(answer),
  };
}

describe('an answer guessed while the person pauses', () => {
  it('matches the final words whatever their capitals and full stop', () => {
    expect(sameWords('what is claude doing', 'What is Claude doing?')).toBe(true);
    expect(sameWords('what is claude doing', 'what is claude doing now')).toBe(false);
    expect(sameWords('', '')).toBe(false);
  });

  it('lets a guess read and never act', () => {
    expect(acts(tool('sessions'))).toBe(false);
    expect(acts(tool('end_conversation'))).toBe(false);
    expect(acts(tool('show'))).toBe(true);
    expect(acts(tool('send_instruction'))).toBe(true);
    expect(acts(tool('propose_rule'))).toBe(true);
    expect(acts(text('Opening it.'))).toBe(false);
  });

  it('says nothing until adopted, then passes on what it held and the rest as it comes', async () => {
    let stops = 0;
    const speculation = new Speculation<string>(() => {
      stops += 1;
    });
    const turn = manualTurn();
    speculation.start('what is claude doing', turn.run);
    turn.begin();
    turn.send(tool('session'));
    turn.send(text('It is fixing '));
    const heard: DaemonAskChunk[] = [];
    const adopted = speculation.adopt('What is Claude doing?', (chunk) =>
      heard.push(chunk),
    );
    expect(heard).toEqual([tool('session'), text('It is fixing ')]);
    turn.send(text('the auth test.'));
    turn.end('It is fixing the auth test.');
    expect(await adopted).toEqual({ answer: 'It is fixing the auth test.' });
    expect(heard).toHaveLength(3);
    expect(stops).toBe(0);
    expect(speculation.takeOvertaken()).toBe(false);
  });

  it('stops before a tool that acts, so half a sentence never opens or sends anything', async () => {
    let stops = 0;
    const speculation = new Speculation<string>(() => {
      stops += 1;
    });
    const turn = manualTurn();
    speculation.start('close the claude tab', turn.run);
    turn.begin();
    turn.send(text('Closing it.'));
    turn.send(tool('show'));
    expect(stops).toBe(1);
    turn.end('');
    const heard: DaemonAskChunk[] = [];
    expect(
      await speculation.adopt('close the claude tab', (chunk) => heard.push(chunk)),
    ).toBe(null);
    // Asked afresh, with the brain told its stopped answer was never theirs.
    expect(heard).toEqual([]);
    expect(speculation.takeOvertaken()).toBe(true);
  });

  it('asks afresh rather than adopt a guess whose turn was cut short, so the words are answered', async () => {
    const speculation = new Speculation<string>(() => undefined);
    const turn = manualTurn();
    speculation.start('why are you slow memnox memnox', turn.run);
    turn.begin();
    turn.send({ kind: BRAIN_CHUNK.CANCELLED });
    turn.end('');
    const heard: DaemonAskChunk[] = [];
    expect(
      await speculation.adopt('Why are you slow? Memnox memnox', (chunk) =>
        heard.push(chunk),
      ),
    ).toBe(null);
    expect(heard).toEqual([]);
    expect(speculation.takeOvertaken()).toBe(true);
  });

  it('drops a guess the person talked on past, and stops the brain only when it is on it', async () => {
    let stops = 0;
    const speculation = new Speculation<string>(() => {
      stops += 1;
    });
    const first = manualTurn();
    speculation.start('open the', first.run);
    first.begin();
    const second = manualTurn();
    speculation.start('open the claude session', second.run);
    expect(stops).toBe(1);
    first.end('');
    // The same words again while one is going start nothing new.
    speculation.start('Open the Claude session.', manualTurn().run);
    second.begin();
    second.end('Opening it.');
    expect(await speculation.adopt('open the claude session', () => undefined)).toEqual({
      answer: 'Opening it.',
    });
  });

  it('never lets a guess overtaken while it waited reach the brain', async () => {
    let stops = 0;
    const speculation = new Speculation<string>(() => {
      stops += 1;
    });
    const queued = manualTurn();
    speculation.start('status', queued.run);
    speculation.drop();
    expect(queued.begin()).toBe(false);
    expect(stops).toBe(0);
    queued.end('');
    expect(speculation.takeOvertaken()).toBe(false);
  });

  it('never waits on a guess the person talked past before it reached the brain', async () => {
    const speculation = new Speculation<string>(() => undefined);
    const gathering = manualTurn();
    speculation.start('ask it to check', gathering.run);
    // The guess never ends, as one still gathering its context has not, and the real question goes on regardless.
    expect(
      await speculation.adopt('ask it to check the git status', () => undefined),
    ).toBe(null);
    expect(gathering.begin()).toBe(false);
  });

  it('disowns a guess the brain finished when the person said something else', async () => {
    const speculation = new Speculation<string>(() => undefined);
    const turn = manualTurn();
    speculation.start('what is codex', turn.run);
    turn.begin();
    turn.end('Codex is idle.');
    expect(await speculation.adopt('what is codex changing', () => undefined)).toBe(null);
    expect(speculation.takeOvertaken()).toBe(true);
  });
});
