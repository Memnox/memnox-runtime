import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerAskCommand } from '../src/commands/ask.command';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';

function brainSaying(chunks: BrainChunk[], heard: string[] = []): Brain {
  return {
    name: 'claude',
    async *ask(said: string) {
      heard.push(said);
      yield* chunks;
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };
}

async function ask(brain: Brain, words: string[]): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerAskCommand(program, new CliContext(out, plainStyle), { brain: () => brain });
  await program.parseAsync(['ask', ...words], { from: 'user' });
  return out;
}

describe('memnox ask', () => {
  it('passes the words through whole, with no keyword in between', async () => {
    const heard: string[] = [];
    await ask(brainSaying([{ kind: BRAIN_CHUNK.DONE }], heard), [
      'yeah',
      'let',
      'it',
      'push,',
      'just',
      'once',
    ]);
    expect(heard).toEqual(['yeah let it push, just once']);
  });

  it('prints whole sentences as they arrive', async () => {
    const out = await ask(
      brainSaying([
        { kind: BRAIN_CHUNK.TEXT, text: 'Two sessions are ' },
        { kind: BRAIN_CHUNK.TEXT, text: 'open. Which one? ' },
        { kind: BRAIN_CHUNK.TEXT, text: 'Checkout or api' },
        { kind: BRAIN_CHUNK.DONE },
      ]),
      ['what', 'is', 'claude', 'doing'],
    );
    expect(out.text).toContain('Two sessions are open.');
    expect(out.text).toContain('Which one?');
    expect(out.text).toContain('Checkout or api');
  });

  it('says a spent plan plainly rather than going quiet', async () => {
    await expect(
      ask(brainSaying([{ kind: BRAIN_CHUNK.LIMITED, text: 'usage limit reached' }]), [
        'hi',
      ]),
    ).rejects.toThrow('claude plan has reached its limit');
  });
});
