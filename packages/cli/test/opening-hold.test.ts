import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeResponse, type DaemonResponse } from '@memnox/core';
import { BrainTurns } from '../src/daemon/brain-turns';
import { OpeningHold } from '../src/daemon/opening-hold';
import { streamTurn } from '../src/daemon/stream-turn';
import { VoiceSurface } from '../src/daemon/voice-surface';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';

class Heard {
  destroyed = false;
  said: DaemonResponse[] = [];
  write(line: string): boolean {
    const response = decodeResponse(line.trim());
    if (response !== null) this.said.push(response);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function brainSaying(chunks: BrainChunk[]): Brain {
  return {
    name: 'claude',
    async *ask() {
      yield* chunks;
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };
}

async function asked(chunks: BrainChunk[]): Promise<DaemonResponse[]> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-opening-'));
  const surface = new VoiceSurface({
    home,
    now: () => new Date().toISOString(),
    log: () => undefined,
    brain: () => brainSaying(chunks),
  });
  const peer = new Heard();
  await surface.respond(peer, { id: 1, method: 'ask', said: 'so I was working on the' });
  surface.close();
  return peer.said;
}

const HOLD = {
  kind: BRAIN_CHUNK.TOOL,
  tool: 'mcp__memnox-operator__keep_listening',
} as const;

describe('the first words of a reply', () => {
  it('are never said when the brain then holds for the rest, since they would talk over the person', async () => {
    const said = await asked([{ kind: BRAIN_CHUNK.TEXT, text: 'I am listening.' }, HOLD]);
    expect(said.filter((each) => each.chunk?.kind === 'text')).toEqual([]);
    expect(said.some((each) => each.chunk?.tool?.endsWith('keep_listening'))).toBe(true);
  });

  it('never interrupt a brain whose turn already ended on a written out hold, which killed its warm process', async () => {
    let cancels = 0;
    const brain: Brain = {
      ...brainSaying([
        { kind: BRAIN_CHUNK.TEXT, text: 'I am listening.' },
        { kind: BRAIN_CHUNK.DONE },
      ]),
      cancel: () => {
        cancels += 1;
      },
    };
    const turn = await streamTurn(
      new BrainTurns(() => brain, 60_000),
      'so I was',
      () => undefined,
    );
    expect(turn.held).toBe(true);
    expect(cancels).toBe(0);
  });

  it('are said whole when they are an answer', async () => {
    const said = await asked([
      { kind: BRAIN_CHUNK.TEXT, text: 'Two sessions ' },
      { kind: BRAIN_CHUNK.TEXT, text: 'are working.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
    const text = said.flatMap((each) =>
      each.chunk?.kind === 'text' ? [each.chunk.text] : [],
    );
    expect(text.join('')).toBe('Two sessions are working.');
  });

  it('go once the moment passes, or once the reply is clearly under way', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const hold = new OpeningHold((text) => out.push(text), 250);
    hold.push('Right ');
    expect(out).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(out).toEqual(['Right ']);
    hold.push('away.');
    expect(out).toEqual(['Right ', 'away.']);
    const long = new OpeningHold((text) => out.push(text), 250);
    long.push(
      'Claude Code has been building the voice bridge for the Mac app all afternoon.',
    );
    expect(out).toHaveLength(3);
    vi.useRealTimers();
  });

  it('waits out a hold the brain wrote out, however slowly the tool follows, as in the voice log', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const hold = new OpeningHold((text) => out.push(text), 250);
    hold.push('I am listening');
    vi.advanceTimersByTime(1_000);
    hold.push(' for the rest.');
    expect(out).toEqual([]);
    expect(hold.settle(true)).toBe(false);
    expect(out).toEqual([]);
    vi.useRealTimers();
  });

  it('says only what follows a waiting line that turned into an answer', () => {
    const out: string[] = [];
    const hold = new OpeningHold((text) => out.push(text), 250);
    hold.push('Standing by. ');
    hold.push('Two sessions are working.');
    hold.settle(false);
    expect(out.join('')).toBe('Two sessions are working.');
  });

  it('lets an answer that only starts like one through', () => {
    const out: string[] = [];
    const hold = new OpeningHold((text) => out.push(text), 250);
    hold.push('I am afraid the push was refused.');
    expect(hold.settle(false)).toBe(false);
    expect(out.join('')).toBe('I am afraid the push was refused.');
  });

  it('turns a reply that only says it is listening into a hold, as in the voice log', async () => {
    const said = await asked([
      { kind: BRAIN_CHUNK.TEXT, text: 'I am listening for the rest.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
    expect(said.filter((each) => each.chunk?.kind === 'text')).toEqual([]);
    expect(said.some((each) => each.chunk?.tool === 'keep_listening')).toBe(true);
  });
});
