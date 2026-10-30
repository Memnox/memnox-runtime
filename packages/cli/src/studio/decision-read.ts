import {
  actionContextOf,
  activityRowOf,
  decisionStepOf,
  decisionTraceOf,
  delegationChain,
  hasRecordedContext,
  LEDGER_LOOKUP_LIMIT,
  leadUpTo,
  publishedSince,
  RULE_SOURCE,
  workspaceRuleOf,
  type DecisionRule,
  type DecisionView,
  type EventRuleRef,
  type MemnoxEvent,
} from '@memnox/core';
import { readNames } from '../agents/names';
import { withEvents } from '../event-store';
import { machinePolicyPath } from '../protect/machine-rules';
import { insteadOf } from '../policy-requests';
import { nameOf } from './activity-read';

/**
 * One decision whole, read back from its row and never recomputed, since today's rules against
 * yesterday's action answer a different question: the rule, the chain, the lead up and the trace.
 */

export async function readDecision(
  home: string,
  id: string,
): Promise<DecisionView | null> {
  return withEvents(home, async (store) => {
    const rows = await store.query({ limit: LEDGER_LOOKUP_LIMIT, withConfig: true });
    const event = rows.find((row) => row.id === id);
    if (event === undefined) return null;
    const [leadUp, names, rule] = await Promise.all([
      leadUpTo(store, event, home),
      readNames(home),
      event.rule === undefined ? undefined : ruleOf(home, event, event.rule),
    ]);
    return {
      row: activityRowOf(event, nameOf(names, event.agent)),
      ...(rule === undefined ? {} : { rule }),
      chain: delegationChain(event),
      context: hasRecordedContext(event) ? actionContextOf(event) : [],
      ...(leadUp.task === null ? {} : { task: leadUp.task.statement }),
      before: leadUp.before.map(decisionStepOf),
      ...(event.alternative === undefined
        ? {}
        : { alternative: insteadOf(event.alternative, event.operation) }),
      trace: decisionTraceOf(event),
    };
  });
}

/** The rule as the row cites it, with who decided it where the workspace published it. */
async function ruleOf(
  home: string,
  event: MemnoxEvent,
  cited: EventRuleRef,
): Promise<DecisionRule> {
  const team = await workspaceRuleOf(home, cited.name);
  const located = {
    name: cited.name,
    ...(cited.file === '' ? {} : { file: cited.file }),
    ...(cited.line === undefined ? {} : { line: cited.line }),
  };
  if (team === null) {
    const source =
      cited.file === machinePolicyPath(home) ? RULE_SOURCE.PERSON : RULE_SOURCE.FILE;
    return { ...located, source };
  }
  return {
    ...located,
    source: RULE_SOURCE.WORKSPACE,
    ...(team.decidedBy === undefined ? {} : { decidedBy: team.decidedBy }),
    ...(team.decidedAt === undefined ? {} : { decidedAt: team.decidedAt }),
    newerSince: publishedSince(team, event.bundleHash),
  };
}
