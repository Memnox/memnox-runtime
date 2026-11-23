import {
  PROPOSAL_KIND,
  Proposals,
  RULE_CHANGE_KIND,
  sentenceOfRule,
  type Proposal,
  type RuleHistoryRow,
} from '@memnox/core';

/** Far enough back to find the change somebody remembers making, without reading every proposal ever kept. */
const HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;
/** A page a person reads, newest first. */
const HISTORY_ROWS = 50;

/**
 * The rule changes a person answered on this machine, newest first: rules added through a signed
 * proposal and rules taken out, confirmed or declined. One still waiting is on Needs you instead.
 */
export async function readRuleHistory(home: string, now: Date): Promise<RuleHistoryRow[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
  const raised = await new Proposals(home).since(since).catch((): Proposal[] => []);
  return raised
    .flatMap((proposal) => rowOf(proposal))
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))
    .slice(0, HISTORY_ROWS);
}

function rowOf(proposal: Proposal): RuleHistoryRow[] {
  const { answer, answeredAt, change } = proposal;
  if (answer === undefined || answeredAt === undefined) return [];
  const shared = {
    id: proposal.id,
    answer,
    answeredAt,
    proposedBy: proposal.proposedBy,
    ...(proposal.answeredBy === undefined ? {} : { answeredBy: proposal.answeredBy }),
  };
  if (change.kind === PROPOSAL_KIND.RULES)
    return [{ ...shared, kind: RULE_CHANGE_KIND.ADDED, rules: change.rules.map(sentenceOfRule) }];
  if (change.kind === PROPOSAL_KIND.RULE_REMOVE)
    return [{ ...shared, kind: RULE_CHANGE_KIND.REMOVED, rules: [change.rule] }];
  return [];
}
