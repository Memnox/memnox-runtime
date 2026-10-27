import { describe, expect, it } from 'vitest';
import { askContext } from '../src/daemon/ask-context';
import { nowIn } from '../src/session-tools/session-tool';

describe('what a session is doing now', () => {
  it('reads the turn in progress from its transcript, never an earlier turn', () => {
    const now = nowIn(
      [
        { at: '2026-10-02T23:20:00.000Z', who: 'person', text: 'check the git history' },
        {
          at: '2026-10-02T23:21:00.000Z',
          who: 'agent',
          text: 'Twenty three commits ahead.',
        },
        { at: '2026-10-02T23:30:00.000Z', who: 'person', text: 'fix the scan overlay' },
        { at: '2026-10-02T23:31:00.000Z', who: 'tool', text: 'Read ScanOverlay.swift' },
        { at: '2026-10-02T23:33:00.000Z', who: 'agent', text: 'The tile is too wide.' },
        { at: '2026-10-02T23:34:00.000Z', who: 'tool', text: 'Edit ScanOverlay.swift' },
      ],
      new Date('2026-10-02T23:36:00.000Z'),
    );
    expect(now).toEqual({
      asked: 'fix the scan overlay',
      askedMinutesAgo: '6',
      lastDid: 'Edit ScanOverlay.swift',
      lastSaid: 'The tile is too wide.',
    });
    expect(nowIn([], new Date())).toBeNull();
  });

  it('lists the session working now first, marked as such, ahead of one that just finished', () => {
    const context = askContext(
      [
        {
          sessionId: 'ses_mac',
          agentName: 'Claude Code',
          state: 'working',
          thinking: true,
          repository: 'memnox-macos',
          actions: 4,
        },
        {
          sessionId: 'ses_git',
          agentName: 'Claude Code',
          state: 'open',
          thinking: false,
          repository: 'memnox-runtime',
          actions: 2,
        },
      ] as never,
      new Date('2026-10-02T23:36:00.000Z'),
    );
    expect(context).toContain('1. Claude Code, working now, mid turn, memnox-macos');
    expect(context).toContain('never one that finished');
  });
});
