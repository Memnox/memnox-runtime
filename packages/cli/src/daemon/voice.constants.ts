/** Half an hour of quiet before the brain's process is let go, since starting it again costs the next answer ten seconds. */
export const BRAIN_IDLE_MS = 30 * 60 * 1_000;

/** Often enough that a held call is spoken while the agent is still waiting on it. */
export const FEED_INTERVAL_MS = 500;

/** A finished session is news for minutes, so the ledger is read for it far less often. */
export const NOTICE_INTERVAL_MS = 10_000;
