/**
 * The words a person answers with, kept apart from the hold and the proposal store so a screen
 * that runs no Node can send them.
 */
export const HOLD_ANSWER = {
  /** This call only. The next identical one asks again. */
  ONCE: 'once',
  /** Every identical call for the rest of this session. */
  SESSION: 'session',
  DENY: 'deny',
  /** The command was wrong rather than the rule, so the person fixes it and the loop survives. */
  EDIT: 'edit',
} as const;

export type HoldAnswer = (typeof HOLD_ANSWER)[keyof typeof HOLD_ANSWER];

export const PROPOSAL_ANSWER = {
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
} as const;

export type ProposalAnswer = (typeof PROPOSAL_ANSWER)[keyof typeof PROPOSAL_ANSWER];
