import type { TestRun } from './watches';

/** How a finished turn's tests stood when it handed back, so nothing celebrates work nobody checked. */
export const TURN_TESTS = {
  /** The last run inside the turn passed and nothing was written after it. */
  PASSED: 'passed',
  /** The last run inside the turn failed. */
  FAILED: 'failed',
  /** The last run passed, but a file was written after it, so the pass no longer covers the work. */
  STALE: 'stale',
  /** The agent ran no tests in the turn. */
  NONE: 'none',
} as const;

export type TurnTests = (typeof TURN_TESTS)[keyof typeof TURN_TESTS];

/** The stretch a turn ran in: from the person's prompt to the agent handing back. */
export interface TurnSpan {
  promptAt: string;
  endedAt: string;
}

/** The last test run inside the turn, weighed against the writes that came after it. */
export function turnTests(
  span: TurnSpan,
  runs: readonly TestRun[],
  writesAt: readonly string[],
): TurnTests {
  const inside = (at: string): boolean => at >= span.promptAt && at <= span.endedAt;
  const last = runs
    .filter((run) => inside(run.at))
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1);
  if (last === undefined) return TURN_TESTS.NONE;
  if (!last.passed) return TURN_TESTS.FAILED;
  const changedSince = writesAt.some((at) => inside(at) && at > last.at);
  return changedSince ? TURN_TESTS.STALE : TURN_TESTS.PASSED;
}
