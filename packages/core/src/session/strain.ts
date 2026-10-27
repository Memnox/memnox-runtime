import { redactSecrets } from '../domain/redact';
import { commandOf, type ActionOutcome } from './breaker';

/**
 * How much trouble a session is in right now, counted from what failed and has not since
 * worked. The breaker stops a session that is stuck; strain narrows one that is struggling,
 * so the change it reaches for after its third failed fix is put to a person first.
 */

/** Failures still standing before a session's reach narrows. */
export const STRAIN_FAILURES = 3;

/** The failing commands named in a reason, since a list nobody reads to the end says nothing. */
const FAILING_SHOWN = 3;

export interface SessionStrain {
  /** Failures whose command has not worked since, counted every time it failed. */
  unresolved: number;
  /** Distinct failing commands, most recent first, in the words a person would type. */
  failing: string[];
  /** Failures that the same command later got past, which is the agent recovering. */
  recovered: number;
}

/**
 * A failure stands until the same work succeeds, the way the breaker reads it: a test that
 * failed twice and then passed is two recovered failures, not two standing ones.
 */
export function strainOf(outcomes: readonly ActionOutcome[]): SessionStrain {
  const standing = new Map<string, { count: number; command: string; at: string }>();
  let recovered = 0;
  for (const outcome of [...outcomes].sort((a, b) => a.at.localeCompare(b.at))) {
    const seen = standing.get(outcome.fingerprint);
    if (!outcome.failed) {
      if (seen !== undefined) recovered += seen.count;
      standing.delete(outcome.fingerprint);
      continue;
    }
    standing.set(outcome.fingerprint, {
      count: (seen?.count ?? 0) + 1,
      command: commandOf(outcome),
      at: outcome.at,
    });
  }
  const open = [...standing.values()].sort((a, b) => b.at.localeCompare(a.at));
  return {
    unresolved: open.reduce((total, each) => total + each.count, 0),
    failing: open.map((each) => each.command),
    recovered,
  };
}

export function isStrained(
  strain: SessionStrain | null | undefined,
  threshold: number = STRAIN_FAILURES,
): strain is SessionStrain {
  return strain !== null && strain !== undefined && strain.unresolved >= threshold;
}

/** The line an ask carries, naming what failed so the person knows what they are trusting. */
export function describeStrain(strain: SessionStrain): string {
  const named = strain.failing.slice(0, FAILING_SHOWN).join(', ');
  const more = strain.failing.length - FAILING_SHOWN;
  const list = more > 0 ? `${named} and ${more} more` : named;
  // Failing commands are quoted to a person and a phone, so a token in one is masked first.
  return redactSecrets(
    `this session has ${strain.unresolved} failures it has not got past (${list}), so a person decides before it changes anything outside this machine or deletes anything`,
  );
}
