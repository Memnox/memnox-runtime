import { describe, expect, it } from 'vitest';

import { weeksOfWork, type MemnoxEvent } from '@memnox/core';

const NOW = new Date('2026-10-07T12:00:00.000Z');

function work(daysAgo: number, sessionId: string, effect = 'allow'): MemnoxEvent {
  const at = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60_000).toISOString();
  return {
    at,
    sessionId,
    effect,
    surface: 'shell',
    operation: 'shell.execute',
  } as MemnoxEvent;
}

describe('questions per week against work per week', () => {
  it('counts each week, and the busy sessions that asked nobody anything', () => {
    const lastWeek = [
      ...Array.from({ length: 6 }, () => work(10, 's1')),
      work(10, 's1', 'ask'),
      work(10, 's1', 'ask'),
    ];
    const thisWeek = [
      ...Array.from({ length: 9 }, () => work(2, 's2')),
      ...Array.from({ length: 5 }, () => work(1, 's3')),
      work(1, 's4'),
      { ...work(1, 's2'), surface: 'config' } as MemnoxEvent,
    ];
    const weeks = weeksOfWork([...lastWeek, ...thisWeek], 2, NOW);
    expect(
      weeks.map(({ actions, asked, sessions, unasked }) => ({
        actions,
        asked,
        sessions,
        unasked,
      })),
    ).toEqual([
      { actions: 8, asked: 2, sessions: 1, unasked: 0 },
      { actions: 15, asked: 0, sessions: 2, unasked: 2 },
    ]);
    expect(weeks[0]?.from).toBe('2026-09-23T12:00:00.000Z');
  });
});
