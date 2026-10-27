import { forgetHeardWord, keepHeardWord } from '../operator/heard-words';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * The brain learning how this person is misheard: a word it got wrong and they corrected is kept,
 * so the next time it is heard that way it is understood at once. It only helps hear them.
 */

const WORD_ARGS = {
  heard: {
    type: 'string',
    description: 'the word or short phrase as it reached you, like "surgeons"',
  },
  meant: {
    type: 'string',
    description: 'what they meant, spelled as it should be, like "sessions"',
  },
} as const;

// Each writes one small list in the person's own home, which changes nothing an agent can do.
const LOCAL_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const HEARD_WORD_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'remember_word',
    description:
      'Remember a word speech recognition gets wrong for this person, so it is understood next time. Call it, alongside your answer and saying in a few words what you learned, when they correct a word you misread, like "no, I said sessions" after "surgeons" reached you, or when they ask you to remember how they say something. Never call it for a guess they did not confirm.',
    inputSchema: { type: 'object', properties: WORD_ARGS },
    annotations: LOCAL_WRITE,
  },
  {
    name: 'forget_word',
    description:
      'Forget a word remembered with remember_word, when they say it was wrong or ask you to forget it.',
    inputSchema: { type: 'object', properties: { heard: WORD_ARGS.heard } },
    annotations: LOCAL_WRITE,
  },
];

export const HEARD_WORD_CALLS: Readonly<Record<string, OperatorCall>> = {
  remember_word: (deps, _seams, args) => rememberWordTool(deps, args),
  forget_word: (deps, _seams, args) => forgetWordTool(deps, args),
};

export async function rememberWordTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const kept = await keepHeardWord(
    deps.home,
    textArg(args, 'heard') ?? '',
    textArg(args, 'meant') ?? '',
    deps.now().toISOString(),
  );
  return kept === null
    ? {
        remembered: false,
        said: 'Not kept: a common or very short word, or a whole sentence, would change everything they say. Use the correction for this sentence only.',
      }
    : { remembered: true, heard: kept.heard, meant: kept.meant };
}

export async function forgetWordTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  return { forgotten: await forgetHeardWord(deps.home, textArg(args, 'heard') ?? '') };
}
