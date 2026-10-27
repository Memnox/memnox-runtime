import { homedir } from 'node:os';
import type { Command } from 'commander';
import type { CliContext } from '../cli-context';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../operator/brain';
import { ownBrain } from '../operator/own-brain';

/**
 * `memnox ask "<anything>"`: the voice without the voice. The same brain, the same tools and
 * the same conversation the Mac app speaks through, so all of it can be tried at a terminal.
 */

interface AskDeps {
  brain: () => Brain;
}

export function registerAskCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<AskDeps> = {},
): void {
  const deps: AskDeps = { brain: () => ownBrain(homedir()), ...overrides };
  program
    .command('ask')
    .description(
      'Ask about your agents in your own words, answered by your own agent CLI',
    )
    .argument('<words...>', 'what you would say out loud')
    .action(async (words: string[]) => runAsk(context, deps.brain(), words.join(' ')));
}

async function runAsk(context: CliContext, brain: Brain, said: string): Promise<void> {
  const { flow, style } = context;
  flow.open('memnox ask');
  const sentences = new SentenceBuffer((sentence) => flow.aside(sentence));
  try {
    for await (const chunk of brain.ask(said)) {
      if (chunk.kind === BRAIN_CHUNK.TEXT) sentences.push(chunk.text ?? '');
      else if (chunk.kind === BRAIN_CHUNK.TOOL)
        flow.aside(style.dim(`reading ${toolName(chunk)}`));
      else finish(brain, chunk);
    }
  } finally {
    sentences.flush();
    brain.close();
  }
  flow.close(style.dim(`answered by your own ${brain.name}`));
}

/** The end of a turn: nothing to add when it answered, the reason when it could not. */
function finish(brain: Brain, chunk: BrainChunk): void {
  if (chunk.kind === BRAIN_CHUNK.LIMITED) {
    throw new Error(
      `Your ${brain.name} plan has reached its limit, so nothing was answered: ${chunk.text ?? ''}`,
    );
  }
  if (chunk.kind === BRAIN_CHUNK.FAILED)
    throw new Error(chunk.text ?? 'the brain failed');
}

/** `mcp__memnox-operator__sessions` as the person would say it. */
function toolName(chunk: BrainChunk): string {
  return (chunk.tool ?? 'the machine').split('__').pop() ?? 'the machine';
}

/** Whole sentences, the unit the voice speaks in, so the terminal reads the same way. */
class SentenceBuffer {
  private text = '';

  constructor(private readonly say: (sentence: string) => void) {}

  push(piece: string): void {
    this.text += piece;
    const end = /[.!?](\s|$)/g;
    let cut = 0;
    for (const match of this.text.matchAll(end)) cut = (match.index ?? 0) + 1;
    if (cut === 0) return;
    this.say(this.text.slice(0, cut).trim());
    this.text = this.text.slice(cut);
  }

  flush(): void {
    if (this.text.trim() !== '') this.say(this.text.trim());
    this.text = '';
  }
}
