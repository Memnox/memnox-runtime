import { describe, expect, it } from 'vitest';
import type { DaemonAskChunk } from '@memnox/core';
import { BrainTurns } from '../src/daemon/brain-turns';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';

/** A brain that answers each turn after a pause, and counts how often it was started and let go. */
class SlowBrain implements Brain {
  readonly name = 'claude';
  closed = 0;
  cancelled = 0;
  warmed = 0;
  constructor(private readonly log: string[]) {}

  async *ask(said: string): AsyncIterable<BrainChunk> {
    this.log.push(`start ${said}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield { kind: BRAIN_CHUNK.TEXT, text: `about ${said}.` };
    this.log.push(`end ${said}`);
    yield { kind: BRAIN_CHUNK.DONE };
  }

  close(): void {
    this.closed += 1;
  }

  cancel(): void {
    this.cancelled += 1;
  }

  async warm(): Promise<void> {
    this.warmed += 1;
  }
}

function collect(into: DaemonAskChunk[]): (chunk: DaemonAskChunk) => void {
  return (chunk) => into.push(chunk);
}

describe('one warm brain behind the daemon', () => {
  it('answers a turn chunk by chunk, ending on done', async () => {
    const turns = new BrainTurns(() => new SlowBrain([]), 60_000);
    const heard: DaemonAskChunk[] = [];
    await turns.ask('sessions', collect(heard));
    turns.close();
    expect(heard).toEqual([
      { kind: BRAIN_CHUNK.TEXT, text: 'about sessions.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
  });

  it('never interleaves two questions in one conversation', async () => {
    const log: string[] = [];
    const turns = new BrainTurns(() => new SlowBrain(log), 60_000);
    await Promise.all([
      turns.ask('first', () => undefined),
      turns.ask('second', () => undefined),
    ]);
    turns.close();
    expect(log).toEqual(['start first', 'end first', 'start second', 'end second']);
  });

  it('starts the brain once and keeps it warm between questions', async () => {
    let started = 0;
    const turns = new BrainTurns(() => {
      started += 1;
      return new SlowBrain([]);
    }, 60_000);
    await turns.ask('one', () => undefined);
    await turns.ask('two', () => undefined);
    turns.close();
    expect(started).toBe(1);
  });

  it('lets a quiet brain go, and starts it again on the next question', async () => {
    const brains: SlowBrain[] = [];
    const turns = new BrainTurns(() => {
      const brain = new SlowBrain([]);
      brains.push(brain);
      return brain;
    }, 10);
    await turns.ask('one', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await turns.ask('two', () => undefined);
    turns.close();
    expect(brains).toHaveLength(2);
    expect(brains[0]?.closed).toBe(1);
  });

  it('ends a turn that threw with a failure the voice can say', async () => {
    const turns = new BrainTurns(
      () => ({
        name: 'claude',
        async *ask(): AsyncIterable<BrainChunk> {
          throw new Error('claude crashed');
        },
        close: () => undefined,
        cancel: () => undefined,
        warm: async () => undefined,
      }),
      60_000,
    );
    const heard: DaemonAskChunk[] = [];
    await turns.ask('hello', collect(heard));
    turns.close();
    expect(heard).toEqual([{ kind: BRAIN_CHUNK.FAILED, text: 'Error: claude crashed' }]);
  });

  it('stops the turn in flight when asked, and says so when nothing is running', async () => {
    const brain = new SlowBrain([]);
    const turns = new BrainTurns(() => brain, 60_000);
    expect(turns.cancel()).toBe(false);

    const running = turns.ask('long answer', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(turns.cancel()).toBe(true);
    await running;
    turns.close();
    expect(brain.cancelled).toBe(1);
  });

  it('starts the brain before the question, and answers on that same warm brain', async () => {
    let started = 0;
    const brain = new SlowBrain([]);
    const turns = new BrainTurns(() => {
      started += 1;
      return brain;
    }, 60_000);
    await turns.warm();
    await turns.ask('what now', () => undefined);
    turns.close();
    expect(brain.warmed).toBe(1);
    expect(started).toBe(1);
  });
});
