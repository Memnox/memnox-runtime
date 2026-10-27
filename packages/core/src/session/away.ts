import {
  describeSpan,
  IN_SECONDS_THEN_MINUTES_THEN_HOURS,
} from '../domain/duration-text';
import { HOUR_MS, MINUTE_MS } from '../domain/time';
import type { MemnoxEvent } from '../event/event';
import { describeRun, runTally, type RunTally } from './notices';
import type { SessionTurn, TurnWindow } from './session-turns';
import { describeWorkEvidence, workEvidenceOf } from './work-evidence';

/**
 * A turn long enough that the person likely walked away, told when it hands back with what
 * it came to, so coming back starts from a summary and not from scrolling a terminal.
 */

/** Shorter turns were probably watched, and the voice already says when one ends. */
export const AWAY_TURN_MS = 15 * MINUTE_MS;
/** How long a finished turn stays news, since one from yesterday greets nobody usefully. */
export const AWAY_KEEP_HOURS = 12;

/** The last turn, when it ran long, has ended, is recent, and the person has not answered it yet. */
export function awayTurn(turn: SessionTurn, now: string): Required<TurnWindow> | null {
  const last = turn.windows?.at(-1);
  if (last?.endedAt === undefined) return null;
  // A prompt after the ending is the person back at it, so the news was already read.
  if (turn.promptAt !== undefined && turn.promptAt > last.endedAt) return null;
  const ran = Date.parse(last.endedAt) - Date.parse(last.promptAt);
  if (ran < AWAY_TURN_MS) return null;
  if (Date.parse(now) - Date.parse(last.endedAt) > AWAY_KEEP_HOURS * HOUR_MS) return null;
  return { promptAt: last.promptAt, endedAt: last.endedAt };
}

export interface AwaySummary {
  run: RunTally;
  summary: string;
}

/** What the turn came to, counted from its own rows: how long, what it did, how it left its tests. */
export function describeAwayTurn(
  agent: string,
  span: Required<TurnWindow>,
  events: readonly MemnoxEvent[],
  now: string,
): AwaySummary {
  const inside = events.filter(
    (event) => event.at >= span.promptAt && event.at <= span.endedAt,
  );
  const run = runTally(inside, span.promptAt, span.endedAt);
  const long = describeSpan(
    Date.parse(span.endedAt) - Date.parse(span.promptAt),
    IN_SECONDS_THEN_MINUTES_THEN_HOURS,
  );
  const work = describeWorkEvidence(workEvidenceOf(inside), now)
    .filter((line) => !line.startsWith('outside: nothing'))
    .map((line) => `${line}.`);
  const told = describeRun(run);
  return {
    run,
    summary: [`${agent} worked ${long} and is waiting on you.`, told, ...work]
      .filter((part) => part !== '')
      .join(' '),
  };
}
