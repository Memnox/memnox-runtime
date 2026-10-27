import { actionContextOf, hasRecordedContext, type MemnoxEvent } from '@memnox/core';

import type { CliContext } from '../../cli-context';
import type { FlowRow } from '../../flow';

/** Said beside a part that carried the verdict, so a person reads which part decided. */
const DECIDED_MARK = '  (decided)';

/**
 * The action read against everything that decided it, one row per part: who it was for,
 * which agent, what the session was for, the call, where it landed, and what came before.
 */
export function renderContext(context: CliContext, event: MemnoxEvent): void {
  if (!hasRecordedContext(event)) {
    context.flow.step(
      'Context',
      'recorded before Memnox kept it, so only the rule is known',
    );
    return;
  }
  const rows: FlowRow[] = actionContextOf(event).map((part) => ({
    label: part.domain,
    value: `${part.facts.join('; ')}${part.decided ? DECIDED_MARK : ''}`,
  }));
  context.flow.rows('Context', rows);
}
