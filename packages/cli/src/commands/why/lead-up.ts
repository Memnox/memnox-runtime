/** What led up to a decision, as `why` prints it; read from the record by core's `leadUpTo`. */
import type { LeadUp } from '@memnox/core';

import type { CliContext } from '../../cli-context';

export function renderLeadUp(context: CliContext, leadUp: LeadUp): void {
  const { flow, style } = context;
  if (leadUp.task !== null) {
    const paths = leadUp.task.scope.paths ?? [];
    flow.rows('The task', [
      { label: 'asked for', value: leadUp.task.statement },
      ...(paths.length === 0 ? [] : [{ label: 'paths', value: paths.join(', ') }]),
    ]);
  }
  if (leadUp.before.length === 0) return;
  flow.rows(
    'Just before',
    leadUp.before.map((each) => ({
      label: each.at.slice(11, 19),
      value: `${each.operation}${each.target === undefined ? '' : ` ${each.target}`}  ${style.dim(each.effect)}`,
    })),
  );
}
