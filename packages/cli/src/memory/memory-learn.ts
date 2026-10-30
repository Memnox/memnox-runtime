import {
  disagrees,
  MEMORY_KIND,
  MEMORY_STATUS,
  OPEN_STATUSES,
  PROPOSAL_ANSWER,
  Proposals,
  ruleDraftProblems,
  type MemoryEditInput,
  type MemoryItem,
  type SqliteMemoryStore,
} from '@memnox/core';
import { proposeLearnedRule } from '../studio/rule-changes';
import { learnedPolicy, ruleOfDraft } from './learned-rule';

/**
 * The person's answers in Learn. A fact or a convention confirmed is verified at once; a rule
 * confirmed raises the same signed proposal any rule does and is verified only once it is signed.
 * A rejection is remembered by its words. Nothing here is reachable by a model or an agent.
 */

/** Who the store names as having decided, since only a person reaches these methods. */
const DECIDED_BY_PERSON = 'person';

export type Learned = { refused: string } | { item: MemoryItem; proposed?: string };

export async function confirmItem(
  home: string,
  store: SqliteMemoryStore,
  id: string,
  now: Date,
): Promise<Learned> {
  const item = openItem(store, id);
  if ('refused' in item) return item;
  const at = now.toISOString();
  if (item.kind === MEMORY_KIND.RULE) return proposeRule(home, store, item, at);
  settle(store, item, { by: DECIDED_BY_PERSON, at });
  return { item: store.item(id) ?? item };
}

/** Verified, what it restates superseded, and what it now disagrees with flagged for the person. */
function settle(
  store: SqliteMemoryStore,
  item: MemoryItem,
  decided: { by: string; at: string },
): void {
  if (item.status === MEMORY_STATUS.CONFLICTING) {
    // Choosing one side of a conflict settles it: the facts it disagreed with are superseded.
    for (const other of store.items({ statuses: [MEMORY_STATUS.CONFLICTING] }))
      if (disagrees(item, other))
        store.decide(other.id, MEMORY_STATUS.SUPERSEDED, decided);
  }
  if (item.duplicateOf !== undefined) {
    const earlier = store.item(item.duplicateOf);
    if (earlier !== null && earlier.status === MEMORY_STATUS.VERIFIED)
      store.decide(earlier.id, MEMORY_STATUS.SUPERSEDED, decided);
  }
  store.decide(item.id, MEMORY_STATUS.VERIFIED, decided);
  store.flagConflicts(item.id, decided.at);
}

async function proposeRule(
  home: string,
  store: SqliteMemoryStore,
  item: MemoryItem,
  at: string,
): Promise<Learned> {
  // Confirmed once already and waiting on the signature, so a second press raises no second card.
  if (item.proposalId !== undefined) return { item, proposed: item.proposalId };
  const policy = learnedPolicy(item);
  if (policy === null) return { refused: `${item.id} names no rule to propose.` };
  const proposed = await proposeLearnedRule(home, policy, at);
  if ('refused' in proposed) return proposed;
  store.setProposal(item.id, proposed.proposed);
  return { item: store.item(item.id) ?? item, proposed: proposed.proposed };
}

export function rejectItem(store: SqliteMemoryStore, id: string, now: Date): Learned {
  const item = openItem(store, id);
  if ('refused' in item) return item;
  store.reject(id, { by: DECIDED_BY_PERSON, at: now.toISOString() });
  return { item: store.item(id) ?? item };
}

/** New words or a new rule, only while it waits on a person; a rule goes through the draft's validator. */
export function editItem(
  store: SqliteMemoryStore,
  id: string,
  edit: MemoryEditInput,
): Learned {
  const item = openItem(store, id);
  if ('refused' in item) return item;
  if (edit.rule !== undefined && item.kind !== MEMORY_KIND.RULE)
    return { refused: `${id} is not a rule candidate, so it takes no rule.` };
  if (edit.rule !== undefined) {
    const problems = ruleDraftProblems(edit.rule);
    if (problems.length > 0)
      return { refused: `The rule would not load: ${problems.join('; ')}` };
  }
  const statement = edit.statement === undefined ? undefined : edit.statement.trim();
  if (statement === '') return { refused: 'A statement says something.' };
  const edited = store.edit(id, {
    ...(statement === undefined ? {} : { statement }),
    ...(edit.subject === undefined ? {} : { subject: edit.subject.trim() }),
    ...(edit.rule === undefined ? {} : { rule: ruleOfDraft(edit.rule, item.rule) }),
  });
  // An edit is a new reading, so a proposal raised from the old words no longer describes it.
  if (edited !== null) store.setProposal(id, null);
  return edited === null ? { refused: `No memory ${id}.` } : { item: edited };
}

/** Rule candidates whose proposal was answered: signed is verified, declined or expired waits again. */
export async function settleProposals(
  home: string,
  store: SqliteMemoryStore,
  now: Date,
): Promise<void> {
  const proposals = new Proposals(home);
  const at = now.toISOString();
  for (const item of store.items({
    statuses: OPEN_STATUSES,
    kinds: [MEMORY_KIND.RULE],
  })) {
    if (item.proposalId === undefined) continue;
    const proposal = await proposals.read(item.proposalId);
    if (proposal !== null && proposal.answer === PROPOSAL_ANSWER.CONFIRMED) {
      store.decide(item.id, MEMORY_STATUS.VERIFIED, {
        by: proposal.answeredBy ?? DECIDED_BY_PERSON,
        at: proposal.answeredAt ?? at,
      });
    } else if (
      proposal === null ||
      proposal.answer !== undefined ||
      proposal.expiresAt <= at
    ) {
      store.setProposal(item.id, null);
    }
  }
}

function openItem(
  store: SqliteMemoryStore,
  id: string,
): MemoryItem | { refused: string } {
  const item = store.item(id);
  if (item === null) return { refused: `No memory ${id}.` };
  if (!OPEN_STATUSES.includes(item.status))
    return { refused: `${id} is ${item.status} already, so there is nothing to answer.` };
  return item;
}
