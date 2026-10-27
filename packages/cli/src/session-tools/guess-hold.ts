import { guessAllows } from '../daemon/guess-state';
import type { ToolDefinition } from './session-tools';

/** Said in place of an action a guess reached for and the person then talked past. */
const GUESS_DROPPED = {
  done: false,
  said: 'They said something else before this was done, so nothing was done. Answer what they said instead.',
};

/**
 * Null when the tool may run now; otherwise what to answer instead. The brain runs a tool before a guess
 * can be stopped, so one that acts waits until the person finished, and runs only for words they kept.
 */
export async function heldInGuess(
  home: string,
  name: string,
  tools: readonly ToolDefinition[],
): Promise<typeof GUESS_DROPPED | null> {
  const reads =
    tools.find((tool) => tool.name === name)?.annotations.readOnlyHint === true;
  if (reads) return null;
  return (await guessAllows(home)) ? null : GUESS_DROPPED;
}
