import { describe, expect, it } from 'vitest';

import { describeRun, runTally, type MemnoxEvent } from '@memnox/core';

function row(at: string, effect: string, surface = 'shell'): MemnoxEvent {
  return { at, effect, surface, operation: 'shell.execute' } as MemnoxEvent;
}

describe('what a turn nobody watched came to', () => {
  const events = [
    row('2026-10-07T10:00:00.000Z', 'allow'),
    row('2026-10-07T10:05:00.000Z', 'allow'),
    row('2026-10-07T10:06:00.000Z', 'deny'),
    row('2026-10-07T10:07:00.000Z', 'allow', 'config'),
    row('2026-10-07T11:30:00.000Z', 'ask'),
  ];

  it("counts the agent work inside the turn and leaves Memnox's own rows out", () => {
    expect(
      runTally(events, '2026-10-07T10:00:00.000Z', '2026-10-07T10:30:00.000Z'),
    ).toEqual({
      actions: 3,
      asked: 0,
      stopped: 1,
    });
  });

  it('says plainly that nobody was asked, and what was stopped', () => {
    expect(describeRun({ actions: 47, asked: 0, stopped: 1 })).toBe(
      'It ran 47 actions and asked you nothing. Memnox stopped 1 action along the way.',
    );
    expect(describeRun({ actions: 3, asked: 2, stopped: 0 })).toBe(
      'It ran 3 actions and asked you 2 times.',
    );
    expect(describeRun({ actions: 0, asked: 0, stopped: 0 })).toBe('');
  });
});
