import { readyToEnable, type BlastRadius } from './autopilot';

/**
 * "Can I leave it running?" answered from what is already known: the boundary the rules
 * draw, and what is stopped or waiting right now. Each concern is a count or a fact that can
 * be checked, so the answer is never a score and never a reassurance.
 */

export interface UnattendedInput {
  agent: string;
  /** False in observe, where nothing the boundary says would actually be stopped. */
  enforcing: boolean;
  radius: BlastRadius;
  /** Calls held for a person right now, each one an agent that is not working. */
  waiting: number;
  /** Sessions the breaker is holding. */
  paused: number;
  /** Budgets with nothing left, so every action they cover is refused. */
  spentBudgets: readonly string[];
}

export interface UnattendedCheck {
  agent: string;
  canLeave: boolean;
  /** In the order a person should deal with them, the one that makes the rest moot first. */
  concerns: string[];
  radius: BlastRadius;
}

export function unattendedCheck(input: UnattendedInput): UnattendedCheck {
  const concerns: string[] = [];
  if (!input.enforcing) {
    concerns.push(
      'Memnox is observing rather than enforcing, so nothing would actually be stopped',
    );
  }
  const ready = readyToEnable(input.radius);
  if (!ready.ready) concerns.push(capitalised(ready.because));
  if (input.waiting > 0) {
    concerns.push(
      `${input.waiting} ${plural(input.waiting, 'call is', 'calls are')} waiting on you`,
    );
  }
  if (input.paused > 0) {
    concerns.push(
      `${input.paused} ${plural(input.paused, 'session is', 'sessions are')} paused by the breaker`,
    );
  }
  for (const budget of input.spentBudgets) {
    concerns.push(`The ${budget} budget is spent, so what it covers is refused`);
  }
  return {
    agent: input.agent,
    canLeave: concerns.length === 0,
    concerns,
    radius: input.radius,
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
