import type { CliContext } from '../../cli-context';
import { TONE } from '../../flow';

/** The list, or nothing at all where nobody has to do anything. */
export function renderPending(context: CliContext, actions: readonly string[]): void {
  if (actions.length === 0) return;
  context.flow.list(
    'What needs you',
    actions.map((text) => ({ tone: TONE.WARN, text })),
  );
}
