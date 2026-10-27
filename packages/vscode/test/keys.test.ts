import { describe, expect, it } from 'vitest';
import { keySequences, pressableKeys } from '../src/keys';

const NOW = '2026-10-14T16:03:00.000Z';

const trust = {
  id: 'dsp_mv8au4cw_6c873b0e',
  display: 'press',
  text: 'down enter',
  tty: 'ttys020',
  expiresAt: '2026-10-14T16:03:30.000Z',
};

describe('answering what an agent asks in an integrated terminal', () => {
  it('presses the keys a trust question needs, as a terminal reads them', () => {
    expect(pressableKeys(trust, '/dev/ttys020', NOW)).toEqual({
      keys: ['\u001b[B', '\r'],
    });
    expect(keySequences('a')).toEqual(['a']);
    expect(keySequences('1, enter')).toEqual(['1', '\r']);
  });

  it('presses nothing but keys, and only for a press still waiting on that terminal', () => {
    expect(keySequences('rm -rf')).toBeNull();
    expect(keySequences('down '.repeat(9))).toBeNull();
    expect(
      pressableKeys({ ...trust, text: 'yes please' }, 'ttys020', NOW),
    ).toHaveProperty('why');
    expect(pressableKeys({ ...trust, display: 'type' }, 'ttys020', NOW)).toHaveProperty(
      'why',
    );
    expect(pressableKeys(trust, 'ttys004', NOW)).toEqual({
      why: 'the link named a different terminal',
    });
  });
});
