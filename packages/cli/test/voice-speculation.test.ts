import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeResponse, type DaemonResponse } from '@memnox/core';
import { FINISHED_NOTE } from '../src/daemon/ask-context';
import { OVERTAKEN_NOTE } from '../src/daemon/speculation';
import { VoiceSurface } from '../src/daemon/voice-surface';
import { BRAIN_CHUNK, type Brain } from '../src/operator/brain';

const NOW = '2026-10-03T12:00:00.000Z';

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

/** A brain that answers each question with its last line, and keeps every prompt it was given. */
function answeringBrain(prompts: string[]): Brain {
  return {
    name: 'claude',
    async *ask(said: string) {
      prompts.push(said);
      yield { kind: BRAIN_CHUNK.TEXT, text: `About ${said.split('\n').pop() ?? ''}.` };
      yield { kind: BRAIN_CHUNK.DONE };
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };
}

async function surfaceWith(prompts: string[]): Promise<VoiceSurface> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-guess-'));
  return new VoiceSurface({
    home,
    now: () => NOW,
    log: () => undefined,
    brain: () => answeringBrain(prompts),
  });
}

describe('answering before the person is known to have finished', () => {
  it('asks the brain once, and speaks the guess only on the ask with the same words', async () => {
    const prompts: string[] = [];
    const surface = await surfaceWith(prompts);
    const guessing = new Heard();
    await surface.respond(guessing, {
      id: 1,
      method: 'ask',
      said: 'what is claude doing',
      speculative: true,
    });
    const asking = new Heard();
    await surface.respond(asking, {
      id: 2,
      method: 'ask',
      said: 'What is Claude doing?',
    });
    surface.close();

    expect(prompts).toHaveLength(1);
    expect(guessing.said).toEqual([{ id: 1, ok: true, outcome: 'guessing' }]);
    expect(asking.said.map((each) => each.chunk?.kind)).toEqual(['text', 'done']);
    expect(asking.said[0]?.chunk?.text).toBe('About what is claude doing.');
  });

  it('asks afresh when they kept talking, and tells the brain the guess was not theirs', async () => {
    const prompts: string[] = [];
    const surface = await surfaceWith(prompts);
    await surface.respond(new Heard(), {
      id: 1,
      method: 'ask',
      said: 'what is claude',
      speculative: true,
    });
    // The guess reaches the brain during the pause, before they carry on.
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    const asking = new Heard();
    await surface.respond(asking, {
      id: 2,
      method: 'ask',
      said: 'what is claude changing in the cart',
    });
    surface.close();

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(OVERTAKEN_NOTE);
    expect(asking.said[0]?.chunk?.text).toBe(
      'About what is claude changing in the cart.',
    );
  });

  it('never lets the brain hold twice running, as in the voice log', async () => {
    const prompts: string[] = [];
    const home = await mkdtemp(join(tmpdir(), 'memnox-guess-'));
    const surface = new VoiceSurface({
      home,
      now: () => NOW,
      log: () => undefined,
      brain: () => ({
        name: 'claude',
        async *ask(said: string) {
          prompts.push(said);
          yield { kind: BRAIN_CHUNK.TOOL, tool: 'keep_listening' };
          yield { kind: BRAIN_CHUNK.DONE };
        },
        close: () => undefined,
        cancel: () => undefined,
        warm: async () => undefined,
      }),
    });
    await surface.respond(new Heard(), {
      id: 1,
      method: 'ask',
      said: 'Can you open a new Claude Code session and ask',
    });
    await surface.respond(new Heard(), {
      id: 2,
      method: 'ask',
      said: 'Can you open a new Claude Code session and ask it to check the git history',
    });
    surface.close();

    expect(prompts[0]).not.toContain(FINISHED_NOTE);
    expect(prompts[1]).toContain(FINISHED_NOTE);
  });
  it('ends the turn out loud when the brain holds on whole words twice, as in the voice log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-guess-'));
    const surface = new VoiceSurface({
      home,
      now: () => NOW,
      log: () => undefined,
      brain: () => ({
        name: 'claude',
        async *ask() {
          yield { kind: BRAIN_CHUNK.TOOL, tool: 'keep_listening' };
          yield { kind: BRAIN_CHUNK.DONE };
        },
        close: () => undefined,
        cancel: () => undefined,
        warm: async () => undefined,
      }),
    });
    const said = 'So you could directly send the instruction up to opening it';
    await surface.respond(new Heard(), { id: 1, method: 'ask', said, speculative: true });
    const asking = new Heard();
    await surface.respond(asking, { id: 2, method: 'ask', said });
    surface.close();

    const chunks = asking.said.map((each) => each.chunk);
    expect(chunks.at(-1)?.kind).toBe(BRAIN_CHUNK.DONE);
    expect(chunks.some((each) => each?.kind === BRAIN_CHUNK.TEXT)).toBe(true);
    expect(chunks.some((each) => each?.tool === 'keep_listening')).toBe(false);
  });

  it('always ends an ask, even when the brain stops without saying it is done', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-guess-'));
    const surface = new VoiceSurface({
      home,
      now: () => NOW,
      log: () => undefined,
      brain: () => ({
        name: 'claude',
        async *ask() {
          yield { kind: BRAIN_CHUNK.TEXT, text: 'Opened it.' };
        },
        close: () => undefined,
        cancel: () => undefined,
        warm: async () => undefined,
      }),
    });
    const asking = new Heard();
    await surface.respond(asking, { id: 1, method: 'ask', said: 'open VS Code' });
    surface.close();

    expect(asking.said.map((each) => each.chunk?.kind).at(-1)).toBe(BRAIN_CHUNK.DONE);
  });
});
