import {
  minutesToMs,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  recipientsOf,
  WORK_ACCOUNT_CHECK,
  workDraftFromText,
  type Proposal,
  type WorkAccount,
} from '@memnox/core';
import type { SessionToolDeps } from './read-tools';

/** Far enough back for "did it go?" asked after a few more turns, and short enough to be about today's sends. */
const SENT_LOOKBACK_MS = minutesToMs(60);

/** The call a draft was proposed for, as the tool takes it. */
interface ProposedCall {
  tool: string;
  argumentsText: string;
}

/** What the voice is told once a draft is on the card: what to read back, and what the person may change there. */
export function proposedReply(
  id: string,
  heard: string,
  account: WorkAccount,
  call: ProposedCall & { toolkit: string },
): { proposed: string; to?: string[]; said: string } {
  const draft = workDraftFromText(call.toolkit, call.tool, call.argumentsText);
  const to = draft.to ?? [];
  const editable = draft.toEditable === true;
  const changes = editable
    ? 'the words and the address'
    : 'the words, though not who it goes to,';
  return {
    proposed: id,
    ...(to.length === 0 ? {} : { to }),
    said: `The draft is on their screen and waits there for them. Read this back: ${heard}.${readdressNote(editable, to)} Then say in a few words that they can change ${changes} on the card and press Send, which asks for Touch ID, and that nothing goes out before. Never offer to send it yourself.${unverifiedNote(account)}`,
  };
}

/** A mail's address is read back exactly, since a name alone hid a misheard address until it had gone out. */
function readdressNote(editable: boolean, to: readonly string[]): string {
  if (!editable || to.length === 0) return '';
  return ` It goes to ${to.join(', ')}: say that address exactly as the card shows it, spelled out where it is not a plain word. When they correct the address out loud, propose a fresh draft at once with the address as they spelled it, rather than insisting the card is right.`;
}

/** The first send from an account is what ties it to them, so it is named rather than called a problem. */
function unverifiedNote(account: WorkAccount): string {
  return account.check === WORK_ACCOUNT_CHECK.MATCHED
    ? ''
    : ' Say the account name as you read it back; their Touch ID on this send ties it to them, so never tell them it needs anything else first.';
}

/**
 * What they sent or were asked to send in their name lately, and whether each went out, so "did you send it?" is
 * answered from what happened rather than guessed. Newest first.
 */
export async function sentTool(deps: SessionToolDeps): Promise<unknown> {
  const since = new Date(deps.now().getTime() - SENT_LOOKBACK_MS).toISOString();
  const raised = await new Proposals(deps.home).since(since);
  const work = raised.filter((each) => each.change.kind === PROPOSAL_KIND.WORK);
  if (work.length === 0) {
    return {
      sent: [],
      said: 'Nothing was put up to send in their name in the last hour. Say so in a sentence.',
    };
  }
  const now = deps.now().toISOString();
  return {
    sent: work.map((each) => ({
      id: each.id,
      what: each.change.kind === PROPOSAL_KIND.WORK ? each.change.label : each.rationale,
      state: stateOf(each, now),
      to: each.ran?.to ?? recipientsProposed(each),
      ...(each.ran === undefined ? {} : { result: each.ran.said }),
    })),
    said: 'Say what became of the one they mean, by its state: sent went out, failed did not and says why, waiting is still on their screen for Touch ID, declined they closed, expired ran out unanswered. Its to is who it went to as sent, the address they typed on the card where they changed it, so name that one. When one failed or expired and they still want it, propose it again at once.',
  };
}

/** Who it was put up to go to, until a send says who it really went to. */
function recipientsProposed(proposal: Proposal): string[] {
  const change = proposal.change;
  if (change.kind !== PROPOSAL_KIND.WORK) return [];
  return recipientsOf(change.toolkit, change.tool, change.argumentsText, change.toName);
}

function stateOf(proposal: Proposal, now: string): string {
  if (proposal.answer === PROPOSAL_ANSWER.DECLINED) return 'declined';
  if (proposal.answer === PROPOSAL_ANSWER.CONFIRMED) {
    if (proposal.ran === undefined) return 'sending';
    return proposal.ran.ok ? 'sent' : 'failed';
  }
  return proposal.expiresAt > now ? 'waiting' : 'expired';
}
