/**
 * The status a person reads beside a session on every surface: the terminal, the console, the
 * Mac app and the phone. One word per status everywhere, so learning one screen is learning all.
 * The copy contract other repositories follow is `docs/ux/contract.json`, checked against this.
 */
export const SESSION_STATUS = {
  /** Something only a person can unblock: a held call, a question, a plan to read. */
  NEEDS_YOU: 'needs-you',
  /** Held by Memnox itself: paused, out of budget, or cut off and resumable. */
  STOPPED: 'stopped',
  WORKING: 'working',
  /** Its turn is over and it handed back, which is news the person has not read yet. */
  FINISHED: 'finished',
  IDLE: 'idle',
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/** What needs a person first, then what Memnox stopped, then the rest. */
export const SESSION_STATUS_ORDER: readonly SessionStatus[] = [
  SESSION_STATUS.NEEDS_YOU,
  SESSION_STATUS.STOPPED,
  SESSION_STATUS.WORKING,
  SESSION_STATUS.FINISHED,
  SESSION_STATUS.IDLE,
];

export const SESSION_STATUS_LABEL: Readonly<Record<SessionStatus, string>> = {
  [SESSION_STATUS.NEEDS_YOU]: 'Needs you',
  [SESSION_STATUS.STOPPED]: 'Stopped',
  [SESSION_STATUS.WORKING]: 'Working',
  [SESSION_STATUS.FINISHED]: 'Finished',
  [SESSION_STATUS.IDLE]: 'Idle',
};

/** Why a session needs its person, named by what they will have to do. */
export const NEEDS_YOU_REASON = {
  APPROVAL: 'approval',
  QUESTION: 'question',
  PLAN: 'plan',
} as const;

export type NeedsYouReason = (typeof NEEDS_YOU_REASON)[keyof typeof NEEDS_YOU_REASON];

/** Why Memnox stopped a session, so the person knows which of their own settings did it. */
export const STOP_REASON = {
  PAUSED: 'paused',
  BREAKER: 'breaker',
  BUDGET: 'budget',
  INTERRUPTED: 'interrupted',
} as const;

export type StopReason = (typeof STOP_REASON)[keyof typeof STOP_REASON];

export type SessionReason = NeedsYouReason | StopReason;

export const SESSION_REASON_LABEL: Readonly<Record<SessionReason, string>> = {
  [NEEDS_YOU_REASON.APPROVAL]: 'Needs approval',
  [NEEDS_YOU_REASON.QUESTION]: 'Has a question',
  [NEEDS_YOU_REASON.PLAN]: 'Plan to review',
  [STOP_REASON.PAUSED]: 'Paused',
  [STOP_REASON.BREAKER]: 'Paused by the breaker',
  [STOP_REASON.BUDGET]: 'Stopped by a budget',
  [STOP_REASON.INTERRUPTED]: 'Interrupted, resumable',
};
