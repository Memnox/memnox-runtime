import { describe, expect, it } from 'vitest';
import { liveHost } from '../src/session-tools/live-host';

describe('where a session runs now', () => {
  it('is nowhere once its process has ended, so nothing types into a tab it left', () => {
    expect(
      liveHost({
        sessionId: 's',
        agent: 'claude-code',
        pid: 2_147_000_000,
        tty: 'ttys007',
        seenAt: 't',
      }),
    ).toBeNull();
  });

  it('keeps a live session, with its terminal as it is now rather than as recorded', () => {
    const live = liveHost({
      sessionId: 's',
      agent: 'claude-code',
      pid: process.pid,
      tty: 'ttys999',
      seenAt: 't',
    });
    expect(live).not.toBeNull();
    expect(live?.tty).not.toBe('ttys999');
  });
});
