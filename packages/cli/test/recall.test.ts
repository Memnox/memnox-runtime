import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStarts } from '@memnox/core';
import { BrainTurns } from '../src/daemon/brain-turns';
import {
  lastAnswered,
  recallContext,
  RecentExchanges,
  waitingOnYes,
} from '../src/daemon/recall';
import { streamTurn } from '../src/daemon/stream-turn';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';

const AT = '2026-10-02T17:29:25.000Z';

describe('what the voice keeps across a fresh brain', () => {
  it('names the offer a yes is answering, with the call that carries it out', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-recall-'));
    const start = await new SessionStarts(home).propose({
      agent: 'codex',
      command: 'codex',
      repository: '/work/memnox-macos',
      task: 'review what we have',
      at: AT,
    });
    const waiting = await waitingOnYes(home, '2026-10-02T17:29:38.000Z');
    expect(waiting).toEqual([expect.stringContaining(`start ${start.id}`)]);
    expect(recallContext([], waiting)).toContain('never ask what they mean');
    // Five minutes on, the offer is stale and nothing is carried.
    expect(await waitingOnYes(home, '2026-10-02T17:35:00.000Z')).toEqual([]);
  });

  it('keeps the last ten exchanges, and forgets a thread from hours ago', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-recall-'));
    const exchanges = new RecentExchanges(home);
    for (let minute = 10; minute < 22; minute += 1) {
      await exchanges.add({
        at: `2026-10-02T17:${minute}:00.000Z`,
        said: `question ${minute}`,
        answered: `answer ${minute}`,
      });
    }
    await exchanges.add({ at: '2026-10-02T17:26:00.000Z', said: 'mm', answered: '' });
    const kept = await exchanges.read('2026-10-02T17:29:00.000Z');
    // A turn of theirs answered with silence still counts, since it may have been a no.
    expect(kept).toHaveLength(10);
    expect(kept[0]?.said).toBe('question 13');
    expect(kept[9]?.said).toBe('mm');
    // Still there after a long lunch, gone by the evening.
    expect(await exchanges.read('2026-10-02T19:30:00.000Z')).toHaveLength(10);
    expect(await exchanges.read('2026-10-02T21:00:00.000Z')).toEqual([]);
  });
});

describe('an offer and the answer to it', () => {
  it('is closed by the next thing they say, so a later yes never reaches it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-recall-'));
    const exchanges = new RecentExchanges(home);
    await exchanges.add({
      at: '2026-10-02T17:29:14.000Z',
      said: 'open codex',
      answered: 'Shall I?',
    });
    await new SessionStarts(home).propose({
      agent: 'codex',
      command: 'codex',
      repository: '/work/memnox-macos',
      task: 'review',
      at: AT,
    });
    const moment = '2026-10-02T17:30:00.000Z';
    expect(
      await waitingOnYes(home, moment, lastAnswered(await exchanges.read(moment))),
    ).toHaveLength(1);
    // News told unasked is not them answering, so the offer still stands.
    await exchanges.add({
      at: '2026-10-02T17:29:30.000Z',
      said: 'news',
      answered: 'It finished.',
      unasked: true,
    });
    expect(
      await waitingOnYes(home, moment, lastAnswered(await exchanges.read(moment))),
    ).toHaveLength(1);
    // A no, answered with silence, still closes it.
    await exchanges.add({ at: '2026-10-02T17:29:40.000Z', said: 'no', answered: '' });
    expect(
      await waitingOnYes(home, moment, lastAnswered(await exchanges.read(moment))),
    ).toEqual([]);
  });

  it('counts a turn only when it ends, never one held for the rest or talked over', async () => {
    const brainSaying = (chunks: BrainChunk[]): Brain => ({
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    });
    const text: BrainChunk = { kind: BRAIN_CHUNK.TEXT, text: 'Done.' };
    const run = (
      chunks: BrainChunk[],
    ): Promise<{ answered: string; ended: boolean; held: boolean }> =>
      streamTurn(
        new BrainTurns(() => brainSaying(chunks), 60_000),
        'yes',
        () => undefined,
      );
    expect(await run([text, { kind: BRAIN_CHUNK.DONE }])).toEqual({
      answered: 'Done.',
      ended: true,
      held: false,
      acted: [],
    });
    expect(
      (
        await run([
          { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__keep_listening' },
          text,
        ])
      ).ended,
    ).toBe(false);
    expect((await run([text, { kind: BRAIN_CHUNK.CANCELLED }])).ended).toBe(false);
  });
});
