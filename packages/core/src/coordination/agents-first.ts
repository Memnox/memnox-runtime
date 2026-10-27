import { minutesToMs } from '../domain/time';
import type { Clash } from './clashes';

/**
 * Two agents on two machines meeting in one file settle it between themselves first, since
 * each can ask the other directly. Their people hear of it only when the held agent is still
 * held off the same lines after that, which is when the agents could not settle it.
 */

/** Long enough for one agent to ask and the other to answer at its next step. */
export const AGENTS_FIRST_MS = minutesToMs(1);

/** A meeting older than this is over, so the map never outgrows a working day. */
const FORGET_MS = minutesToMs(30);

/** Clashes on this machine, between this person's own agents, are theirs to hear at once. */
function heldByAnotherMachine(clash: Clash): clash is Clash & { leaseId: string } {
  return clash.leaseId !== undefined;
}

export class AgentsFirst {
  /** When each held session first met each lease, so a later clash knows how long it has been. */
  private readonly firstMet = new Map<string, number>();
  private readonly told = new Set<string>();

  /** The clashes a person should hear now, out of those just seen. */
  forPerson(clashes: readonly Clash[]): Clash[] {
    this.forget(clashes.at(-1));
    return clashes.filter((clash) => {
      if (!heldByAnotherMachine(clash)) return true;
      const key = `${clash.sessionId}\n${clash.leaseId}`;
      const at = Date.parse(clash.at);
      const first = this.firstMet.get(key);
      if (first === undefined) {
        this.firstMet.set(key, at);
        return false;
      }
      if (this.told.has(key) || at - first < AGENTS_FIRST_MS) return false;
      this.told.add(key);
      return true;
    });
  }

  private forget(latest: Clash | undefined): void {
    if (latest === undefined) return;
    const oldest = Date.parse(latest.at) - FORGET_MS;
    for (const [key, first] of this.firstMet) {
      if (first >= oldest) continue;
      this.firstMet.delete(key);
      this.told.delete(key);
    }
  }
}
