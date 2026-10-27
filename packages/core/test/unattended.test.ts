import { describe, expect, it } from 'vitest';
import type { BlastRadius } from '../src/session/autopilot';
import { unattendedCheck, type UnattendedInput } from '../src/session/unattended';

const HELD_BACK: BlastRadius = {
  credentials: [],
  automatic: 12,
  needsApproval: 4,
  never: 3,
  ungoverned: 2,
  destructiveAutomatic: false,
};

const CALM: UnattendedInput = {
  agent: 'claude-code',
  enforcing: true,
  radius: HELD_BACK,
  waiting: 0,
  paused: 0,
  spentBudgets: [],
};

describe('whether an agent can be left running', () => {
  it('says yes when the rules hold and nothing is waiting or stopped', () => {
    const check = unattendedCheck(CALM);
    expect(check.canLeave).toBe(true);
    expect(check.concerns).toEqual([]);
  });

  it('says no in observe first, because every other line assumes something is enforced', () => {
    const check = unattendedCheck({ ...CALM, enforcing: false, waiting: 2 });
    expect(check.canLeave).toBe(false);
    expect(check.concerns[0]).toContain('observing');
    expect(check.concerns[1]).toBe('2 calls are waiting on you');
  });

  it('refuses while something destructive would run unasked', () => {
    const check = unattendedCheck({
      ...CALM,
      radius: { ...HELD_BACK, destructiveAutomatic: true },
    });
    expect(check.concerns).toEqual(['Something destructive would run without asking']);
  });

  it('counts paused sessions and spent budgets, one concern each', () => {
    const check = unattendedCheck({ ...CALM, paused: 1, spentBudgets: ['deploys'] });
    expect(check.concerns).toEqual([
      '1 session is paused by the breaker',
      'The deploys budget is spent, so what it covers is refused',
    ]);
  });
});
