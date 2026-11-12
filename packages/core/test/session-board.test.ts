import { describe, expect, it } from 'vitest';
import {
  BREAKER_SIGNAL,
  SESSION_ACTIVITY,
  SESSION_STATUS,
  sessionBoard,
  sessionStatusOf,
  type SessionFacts,
} from '../src/index';

const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  sessionId: 'ses_1',
  agent: 'claude-code',
  activity: SESSION_ACTIVITY.WORKING,
  lastActive: '2026-11-11T10:00:00.000Z',
  waiting: 0,
  ...over,
});

describe('a session status', () => {
  it('needs the person whenever a call of its waits on them, whatever it was doing', () => {
    expect(sessionStatusOf(facts({ waiting: 1 }))).toEqual({
      status: SESSION_STATUS.NEEDS_YOU,
      reason: 'approval',
    });
  });

  it('says a person paused it, apart from the breaker pausing it', () => {
    expect(sessionStatusOf(facts({ pausedBy: BREAKER_SIGNAL.ASKED }))?.reason).toBe(
      'paused',
    );
    expect(sessionStatusOf(facts({ pausedBy: BREAKER_SIGNAL.ERROR_LOOP }))?.reason).toBe(
      'breaker',
    );
  });

  it('calls a handed back session finished, and a cut off one resumable', () => {
    expect(
      sessionStatusOf(facts({ activity: SESSION_ACTIVITY.HANDED_BACK }))?.status,
    ).toBe(SESSION_STATUS.FINISHED);
    expect(
      sessionStatusOf(facts({ activity: SESSION_ACTIVITY.INTERRUPTED }))?.reason,
    ).toBe('interrupted');
  });

  it('leaves a session the person closed off the board', () => {
    expect(sessionStatusOf(facts({ activity: SESSION_ACTIVITY.ENDED }))).toBeNull();
  });
});

describe('the board', () => {
  it('puts what needs a person first, leaves empty groups out, and newest first inside', () => {
    const board = sessionBoard([
      facts({ sessionId: 'ses_idle', activity: SESSION_ACTIVITY.QUIET }),
      facts({ sessionId: 'ses_old', lastActive: '2026-11-11T09:00:00.000Z' }),
      facts({ sessionId: 'ses_new' }),
      facts({ sessionId: 'ses_held', waiting: 2 }),
    ]);

    expect(board.map((group) => group.label)).toEqual(['Needs you', 'Working', 'Idle']);
    expect(board[1]?.rows.map((row) => row.sessionId)).toEqual(['ses_new', 'ses_old']);
    expect(board[0]?.rows[0]?.reasonLabel).toBe('Needs approval');
  });
});
