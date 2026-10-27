import {
  confirmationMessage,
  editedArguments,
  editedRecipients,
  PROPOSAL_KIND,
  recipientsOf,
  type Proposal,
  type ProposalRan,
  type ProposedChange,
} from '@memnox/core';
import type { ConfirmResult } from './confirm';

/** What a confirm says it answers, and the words and addresses the person rewrote on its card. */
interface Answered {
  subject: string;
  answer: string;
  edited?: string;
  editedTo?: string;
}

/** The text a key signed for this answer, so rewritten words and addresses are covered as they will go. */
export function signedMessage(input: Answered): string {
  return confirmationMessage(input.subject, input.answer, input.edited, input.editedTo);
}

/** What a send in the person's name came to, and whom it went to: the card's addresses where they rewrote them. */
export function ranOf(
  change: ProposedChange,
  applied: ConfirmResult,
  at: string,
): ProposalRan {
  const ran = { ok: applied.ok, said: applied.ok ? applied.outcome : applied.error, at };
  if (change.kind !== PROPOSAL_KIND.WORK) return ran;
  const to = recipientsOf(
    change.toolkit,
    change.tool,
    change.argumentsText,
    change.toName,
  );
  return to.length === 0 ? ran : { ...ran, to };
}

/**
 * A draft the person rewrote on its card before Send: carried out with their words and, on a mail, their
 * addresses in place of the proposed ones. Null where nothing on that proposal is what they could have rewritten.
 */
export function editedProposal(
  proposal: Proposal,
  edited: string | undefined,
  editedTo?: string,
): Proposal | null {
  if (edited === undefined && editedTo === undefined) return proposal;
  const change = proposal.change;
  if (change.kind !== PROPOSAL_KIND.WORK) return null;
  let argumentsText: string | null = change.argumentsText;
  if (edited !== undefined) {
    if (edited.trim() === '') return null;
    argumentsText = editedArguments(argumentsText, edited);
  }
  if (argumentsText === null) return null;
  if (editedTo === undefined)
    return { ...proposal, change: { ...change, argumentsText } };
  const readdressed = editedRecipients(change.toolkit, argumentsText, editedTo);
  if (readdressed === null) return null;
  // The name the voice found was for the address it replaced, so it never follows a new one.
  const kept = { ...change, argumentsText: readdressed };
  if (readdressed !== argumentsText) delete kept.toName;
  return { ...proposal, change: kept };
}
