/** What a check comes to once everything that could answer it has: it runs, or it does not. */
export const VERDICT = {
  ALLOW: 'allow',
  DENY: 'deny',
} as const;

export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/** Where a question raised to the control plane stands. */
export const HELD_STATUS = {
  PENDING: 'pending',
  ANSWERED: 'answered',
  EXPIRED: 'expired',
} as const;

export type HeldStatusName = (typeof HELD_STATUS)[keyof typeof HELD_STATUS];

/** The answers a person gives, as the control plane spells them. */
export const HELD_ANSWER = {
  ONCE: 'once',
  SESSION: 'session',
  DENY: 'deny',
} as const;

export type HeldAnswer = (typeof HELD_ANSWER)[keyof typeof HELD_ANSWER];

/** The environment a guard reads when it is not handed its settings. */
export const GUARD_ENV = {
  TOKEN: 'MEMNOX_TOKEN',
  WORKSPACE: 'MEMNOX_WORKSPACE',
  URL: 'MEMNOX_URL',
  AGENT: 'MEMNOX_AGENT',
} as const;

export const DEFAULT_CLOUD_URL = 'https://api.memnox.com';

/** How long an action waits on a person before it is refused for want of an answer. */
export const DEFAULT_WAIT_MS = 120_000;

/** Each long poll's window, under the time a proxy or a load balancer closes an idle request. */
export const LONG_POLL_SECONDS = 25;

/** How long a first check waits for the workspace's rules before deciding with the defaults. */
export const FIRST_RULES_MS = 3_000;

/** How often the rules are fetched again; an unchanged set costs one 304. */
export const RULES_REFRESH_MS = 60_000;

/** How often decisions are sent, and how many at most at once. */
export const RECORD_EVERY_MS = 2_000;
export const RECORD_BATCH = 100;

/** The event kinds the control plane's activity projection reads. */
export const RECORD_KIND = {
  SESSION_STARTED: 'agent.session.started',
  ACTION_RECORDED: 'agent.action.recorded',
  SESSION_PAUSED: 'agent.session.paused',
} as const;

/** How often a paused session asks whether a person resumed it, so a stuck loop costs one request per window. */
export const RESUME_CHECK_MS = 10_000;
