import { describe, expect, it } from 'vitest';
import { deliveryRow } from '../src/gate/delivery-row';

const BASE = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  text: 'push the voice branch',
  at: '2026-10-05T12:00:00.000Z',
};

describe('what became of a spoken instruction, as a row in the agent session', () => {
  it('says it landed with what was checked and where the screenshot is', () => {
    const row = deliveryRow({
      ...BASE,
      outcome: 'verified',
      proof: { checked: 'the words in its terminal tab', image: '/p/req.png' },
    });
    expect(row).toMatchObject({
      sessionId: 'ses_1',
      agent: 'claude-code',
      actorType: 'human',
      operation: 'voice.delivered',
      target: 'verified',
    });
    expect(row.reason).toContain('saw it land');
    expect(row.reason).toContain('the words in its terminal tab');
    expect(row.reason).toContain('/p/req.png');
  });

  it('never calls an unchecked send landed', () => {
    const row = deliveryRow({ ...BASE, outcome: 'typed' });
    expect(row.reason).toContain('nothing read it back');
    expect(row.reason).not.toContain('saw it land');
  });

  it('keeps the words out of the row', () => {
    const row = deliveryRow({ ...BASE, outcome: 'failed', reason: 'no tab holds it' });
    expect(JSON.stringify(row)).not.toContain('voice branch');
    expect(row.reason).toContain('because no tab holds it');
  });
});
