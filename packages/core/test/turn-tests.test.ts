import { describe, expect, it } from 'vitest';
import { TURN_TESTS, turnTests, type TestRun } from '../src/index';

const SPAN = {
  promptAt: '2026-10-04T10:00:00.000Z',
  endedAt: '2026-10-04T10:20:00.000Z',
};

function run(at: string, passed: boolean): TestRun {
  return { at: `2026-10-04T${at}:00.000Z`, command: 'pnpm test', passed };
}

describe('how a finished turn left its tests', () => {
  it('passes only when the last run inside the turn passed and nothing was written after it', () => {
    const runs = [run('10:05', false), run('10:15', true)];
    expect(turnTests(SPAN, runs, ['2026-10-04T10:10:00.000Z'])).toBe(TURN_TESTS.PASSED);
  });

  it('calls a pass followed by a write stale, since the pass no longer covers the work', () => {
    const runs = [run('10:15', true)];
    expect(turnTests(SPAN, runs, ['2026-10-04T10:18:00.000Z'])).toBe(TURN_TESTS.STALE);
  });

  it('reports the last run failing even after an earlier pass', () => {
    expect(turnTests(SPAN, [run('10:05', true), run('10:15', false)], [])).toBe(
      TURN_TESTS.FAILED,
    );
  });

  it('counts no run outside the turn, before or after it', () => {
    expect(turnTests(SPAN, [run('09:55', true), run('10:25', true)], [])).toBe(
      TURN_TESTS.NONE,
    );
  });

  it('ignores a write outside the turn when weighing a pass', () => {
    expect(turnTests(SPAN, [run('10:15', true)], ['2026-10-04T10:30:00.000Z'])).toBe(
      TURN_TESTS.PASSED,
    );
  });
});
