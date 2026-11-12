import {
  NEEDS_YOU_REASON,
  SESSION_REASON_LABEL,
  SESSION_STATUS,
  SESSION_STATUS_LABEL,
  SESSION_STATUS_ORDER,
  STOP_REASON,
  type SessionReason,
  type SessionStatus,
} from '../constants/session-status.constants';
import { BREAKER_SIGNAL, type BreakerSignal } from './breaker';

/**
 * Every live session on one screen, grouped by what it needs, with what needs a person first.
 * Pure: the caller reads the ledger, the pauses and the held calls, and this only sorts them,
 * so the terminal and every app that asks the daemon draw the same board.
 */

/** What a session was last seen doing, before anything Memnox holds it for is weighed. */
export const SESSION_ACTIVITY = {
  WORKING: 'working',
  /** Its turn is over and it handed back to the person. */
  HANDED_BACK: 'handed-back',
  QUIET: 'quiet',
  /** Closed by the person, so it is not on the board at all. */
  ENDED: 'ended',
  /** Its process went away with nothing closing it, so it can be picked up again. */
  INTERRUPTED: 'interrupted',
} as const;

export type SessionActivity = (typeof SESSION_ACTIVITY)[keyof typeof SESSION_ACTIVITY];

export interface SessionFacts {
  sessionId: string;
  agent: string;
  activity: SessionActivity;
  lastActive: string;
  /** Held calls waiting on the person for this session. */
  waiting: number;
  /** Why it is paused, when it is. */
  pausedBy?: BreakerSignal;
  /** The folder it works in, by name. */
  place?: string;
  /** What it was asked to do, in the person's words. */
  task?: string;
}

export interface BoardRow extends SessionFacts {
  status: SessionStatus;
  reason?: SessionReason;
  /** The reason as a person reads it, so no surface words it its own way. */
  reasonLabel?: string;
}

export interface BoardGroup {
  status: SessionStatus;
  label: string;
  rows: BoardRow[];
}

/** One session's status and why, or null for one that is over. */
export function sessionStatusOf(
  facts: SessionFacts,
): { status: SessionStatus; reason?: SessionReason } | null {
  if (facts.activity === SESSION_ACTIVITY.ENDED) return null;
  if (facts.waiting > 0) {
    return { status: SESSION_STATUS.NEEDS_YOU, reason: NEEDS_YOU_REASON.APPROVAL };
  }
  if (facts.pausedBy !== undefined) {
    const reason =
      facts.pausedBy === BREAKER_SIGNAL.ASKED ? STOP_REASON.PAUSED : STOP_REASON.BREAKER;
    return { status: SESSION_STATUS.STOPPED, reason };
  }
  if (facts.activity === SESSION_ACTIVITY.INTERRUPTED) {
    return { status: SESSION_STATUS.STOPPED, reason: STOP_REASON.INTERRUPTED };
  }
  if (facts.activity === SESSION_ACTIVITY.WORKING)
    return { status: SESSION_STATUS.WORKING };
  if (facts.activity === SESSION_ACTIVITY.HANDED_BACK) {
    return { status: SESSION_STATUS.FINISHED };
  }
  return { status: SESSION_STATUS.IDLE };
}

/** The board: groups in the shared order, empty ones left out, newest first inside each. */
export function sessionBoard(sessions: readonly SessionFacts[]): BoardGroup[] {
  const rows: BoardRow[] = [];
  for (const facts of sessions) {
    const status = sessionStatusOf(facts);
    if (status === null) continue;
    rows.push({
      ...facts,
      ...status,
      ...(status.reason === undefined
        ? {}
        : { reasonLabel: SESSION_REASON_LABEL[status.reason] }),
    });
  }
  return SESSION_STATUS_ORDER.map((status) => ({
    status,
    label: SESSION_STATUS_LABEL[status],
    rows: rows
      .filter((row) => row.status === status)
      .sort((a, b) => b.lastActive.localeCompare(a.lastActive)),
  })).filter((group) => group.rows.length > 0);
}
