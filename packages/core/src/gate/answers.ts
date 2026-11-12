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

/**
 * The button a person presses, worded the same on the terminal, the console, the Mac and the
 * phone. Checked against `docs/ux/contract.json`, the copy the other repositories follow.
 */
export const HOLD_ANSWER_LABEL: Readonly<Record<HoldAnswer, string>> = {
  [HOLD_ANSWER.ONCE]: 'Allow once',
  [HOLD_ANSWER.SESSION]: 'Allow for this session',
  [HOLD_ANSWER.EDIT]: 'Edit the command first',
  [HOLD_ANSWER.DENY]: 'Deny',
};

/** The order every surface lists them in: the narrowest yes first, and Deny always last. */
export const HOLD_ANSWER_ORDER: readonly HoldAnswer[] = [
  HOLD_ANSWER.ONCE,
  HOLD_ANSWER.SESSION,
  HOLD_ANSWER.EDIT,
  HOLD_ANSWER.DENY,
];

/** What is left on screen once a call is decided: "allowed once", "denied". */
export const HOLD_OUTCOME_WORD: Readonly<Record<HoldAnswer, string>> = {
  [HOLD_ANSWER.ONCE]: 'allowed once',
  [HOLD_ANSWER.SESSION]: 'allowed for this session',
  [HOLD_ANSWER.EDIT]: 'editing',
  [HOLD_ANSWER.DENY]: 'denied',
};

/** The answers that write a rule rather than deciding one call, offered only where a rule can be signed. */
export const ALWAYS_ALLOW_LABEL = 'Always allow';
export const ALWAYS_DENY_LABEL = 'Always deny';

export const PROPOSAL_ANSWER = {
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
} as const;

export type ProposalAnswer = (typeof PROPOSAL_ANSWER)[keyof typeof PROPOSAL_ANSWER];
