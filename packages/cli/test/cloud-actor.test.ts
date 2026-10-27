import { describe, expect, it } from 'vitest';
import { ACTOR_TYPE } from '@memnox/core';
import { eventOf } from '../src/sync/cloud-event';
import { protectionEvents } from '../src/sync/protection-changes';

/* The ledger says `human` and the control plane only accepts `person`, so one row about a
   person stopping protection or clearing a taint had the whole batch refused. */
describe('who acted, in the control plane’s own word', () => {
  it('sends a person as `person`', () => {
    const row = eventOf({
      kind: 'action_recorded',
      dedupKey: 'k',
      subjectId: 's',
      actorType: ACTOR_TYPE.HUMAN,
      occurredAt: 0,
      payload: {},
    } as never);
    expect(row.actorType).toBe('person');
  });

  it('sends a person stopping protection as `person`, and the timer as automation', () => {
    const [stopped, resumed] = protectionEvents([
      {
        kind: 'protection_stopped',
        id: 'c1',
        at: '2026-09-27T00:00:00.000Z',
        by: 'maya',
        mode: 'enforce',
      },
      {
        kind: 'protection_resumed',
        id: 'c2',
        at: '2026-09-27T01:00:00.000Z',
        by: 'timer',
        mode: 'enforce',
        timer: true,
      },
    ] as never);
    expect(stopped?.actorType).toBe('person');
    expect(resumed?.actorType).toBe(ACTOR_TYPE.AUTOMATION);
  });
});
