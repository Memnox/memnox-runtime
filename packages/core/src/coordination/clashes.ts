import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { DECISION_EFFECT } from '../constants/decision.constants';
import { shortDigest } from '../domain/digest';
import { HOUR_MS } from '../domain/time';
import type { MemnoxEvent } from '../event/event';
import type { WorkObservation } from '../ledger/collision';
import { JsonRecordDir } from '../store/json-records';
import { takesLease } from './writes';

/**
 * Two agents meeting on one piece of work: what the ledger shows they both touched, and the
 * moment a write was held because another agent, here or on another machine, had it. Kept so
 * the voice can tell the person, since a hold an agent works around is a clash nobody saw.
 */

/** One write held by another agent's claim, said as the seam said it to the agent. */
export interface Clash {
  id: string;
  at: string;
  /** The session that was held, and its agent. */
  sessionId: string;
  agent: string;
  /** What it was trying to change: a path, or an action such as closing a pull request. */
  what: string;
  /** Who has it, where and since when, in the words the agent was given. */
  said: string;
  /** The workspace lease in the way, where another machine holds it, so its owner can be asked for it. */
  leaseId?: string;
}

/** Only what actually touched something: a refused attempt is not shared work. */
export function workObservationsOf(events: readonly MemnoxEvent[]): WorkObservation[] {
  return events.flatMap((event) =>
    event.target !== undefined && event.effect === DECISION_EFFECT.ALLOW
      ? [
          {
            agentId: event.sessionId,
            agentName: event.agent,
            target: event.target,
            at: event.at,
            // Asked of the same function the lease gate asks, so the two agree on what writes.
            writing: takesLease(event.class),
          },
        ]
      : [],
  );
}

const CLASHES_DIR = 'clashes';

/** Long enough for any voice to have been listening; a clash older than this is history. */
const CLASH_KEPT_MS = 24 * HOUR_MS;

export class Clashes {
  private readonly records: JsonRecordDir<Clash>;

  constructor(home: string) {
    this.records = new JsonRecordDir(Clashes.directory(home));
  }

  /** Where clashes land, so the daemon can watch for one rather than look every few seconds. */
  static directory(home: string): string {
    return join(home, MEMNOX_HOME, CLASHES_DIR);
  }

  /**
   * Once per session, thing and holder, so an agent retrying the same held write is one clash
   * rather than one for every attempt.
   */
  async note(input: Omit<Clash, 'id'>): Promise<void> {
    const id = `clh_${shortDigest(`${input.sessionId}\n${input.what}\n${input.said}`)}`;
    if ((await this.records.read(id)) !== null) return;
    await this.records.write(id, { id, ...input });
  }

  /** Clashes noted after a moment, oldest first, letting go of any past keeping. */
  async since(moment: string, now: string): Promise<Clash[]> {
    const all = await this.records.all();
    const cutoff = Date.parse(now) - CLASH_KEPT_MS;
    await Promise.all(
      all
        .filter((each) => Date.parse(each.at) < cutoff)
        .map((each) => this.records.remove(each.id)),
    );
    return all
      .filter((each) => each.at > moment)
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}
