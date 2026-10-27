import { DECISION_EFFECT } from '../constants/decision.constants';
import { EVENT_SURFACE, type MemnoxEvent } from '../event/event';

/**
 * Questions per week against work per week, so "you are asked less every week" is something a
 * person reads off their own ledger. Counts only: no hours saved, which nobody could check.
 */

/** A session this busy that asked nothing is one that ran with nobody watching it. */
export const UNATTENDED_SESSION_ACTIONS = 5;

const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface WeekOfWork {
  /** The first instant the week covers. */
  from: string;
  actions: number;
  /** Put to a person, whatever they answered. */
  asked: number;
  /** Sessions of real work in the week. */
  sessions: number;
  /** Of those, the ones that never asked anybody anything. */
  unasked: number;
}

/** The last `weeks` weeks ending at `now`, oldest first, from agent work only. */
export function weeksOfWork(
  events: readonly MemnoxEvent[],
  weeks: number,
  now: Date,
): WeekOfWork[] {
  const end = now.getTime();
  return Array.from({ length: weeks }, (_, index) => {
    const from = end - (weeks - index) * WEEK_MS;
    const to = from + WEEK_MS;
    const work = events.filter((event) => {
      const at = Date.parse(event.at);
      // A config change or a summary row is Memnox's own and never counted as work.
      return at >= from && at < to && event.surface !== EVENT_SURFACE.CONFIG;
    });
    return { from: new Date(from).toISOString(), ...tallyOf(work) };
  });
}

function tallyOf(work: readonly MemnoxEvent[]): Omit<WeekOfWork, 'from'> {
  const bySession = new Map<string, { actions: number; asked: number }>();
  for (const event of work) {
    const session = bySession.get(event.sessionId) ?? { actions: 0, asked: 0 };
    session.actions += 1;
    if (event.effect === DECISION_EFFECT.ASK) session.asked += 1;
    bySession.set(event.sessionId, session);
  }
  const busy = [...bySession.values()].filter(
    (session) => session.actions >= UNATTENDED_SESSION_ACTIONS,
  );
  return {
    actions: work.length,
    asked: work.filter((event) => event.effect === DECISION_EFFECT.ASK).length,
    sessions: busy.length,
    unasked: busy.filter((session) => session.asked === 0).length,
  };
}
