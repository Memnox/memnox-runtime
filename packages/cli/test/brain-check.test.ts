import { describe, expect, it } from 'vitest';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';
import { checkBrain } from '../src/operator/brain-check';
import { voiceBrainSpec, type VoiceBrainSpec } from '../src/operator/voice-brains';

function spec(kind: string): VoiceBrainSpec {
  const found = voiceBrainSpec(kind);
  if (found === null) throw new Error(`no brain ${kind}`);
  return found;
}

/** A brain that answers every question with the chunks it was given. */
function scripted(chunks: BrainChunk[]): Brain & { closed: boolean } {
  return {
    name: 'scripted',
    closed: false,
    async *ask(): AsyncIterable<BrainChunk> {
      yield* chunks;
    },
    close() {
      this.closed = true;
    },
    cancel() {},
    async warm() {},
  };
}

const ANSWERS: BrainChunk[] = [
  { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__sessions' },
  { kind: BRAIN_CHUNK.TEXT, text: 'Memnox ready.' },
  { kind: BRAIN_CHUNK.DONE },
];

describe('checkBrain', () => {
  it('passes an agent that read a Memnox tool and said the words', async () => {
    const brain = scripted(ANSWERS);

    const checked = await checkBrain(spec('cursor'), brain);

    expect(checked.works).toBe(true);
    expect(brain.closed).toBe(true);
  });

  it('fails a spent plan, which ends its turn as normally as an answer', async () => {
    const checked = await checkBrain(
      spec('cursor'),
      scripted([
        { kind: BRAIN_CHUNK.TEXT, text: '\n\nUpgrade your plan to continue' },
        { kind: BRAIN_CHUNK.DONE },
      ]),
    );

    expect(checked).toMatchObject({
      works: false,
      because:
        'its own account replied "Upgrade your plan to continue", so it cannot be the voice yet',
      reply: 'Upgrade your plan to continue',
    });
  });

  it('fails an agent that answered without the Memnox tools', async () => {
    const checked = await checkBrain(
      spec('openclaw'),
      scripted([
        { kind: BRAIN_CHUNK.TEXT, text: 'memnox ready' },
        { kind: BRAIN_CHUNK.DONE },
      ]),
    );

    expect(checked).toMatchObject({
      works: false,
      because: 'it answered without the Memnox tools',
    });
  });

  it('passes on what the brain said went wrong', async () => {
    const checked = await checkBrain(
      spec('hermes'),
      scripted([{ kind: BRAIN_CHUNK.FAILED, text: 'Hermes is not logged in' }]),
    );

    expect(checked).toMatchObject({ works: false, because: 'Hermes is not logged in' });
  });

  it('gives up on a brain that never answers', async () => {
    const silent: Brain = {
      name: 'silent',
      ask: async function* () {
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield { kind: BRAIN_CHUNK.CANCELLED };
      },
      close() {},
      cancel() {},
      async warm() {},
    };

    const checked = await checkBrain(spec('codex'), silent, 50);

    expect(checked).toMatchObject({
      works: false,
      because: 'no answer within 0.05 seconds',
    });
  });
});
