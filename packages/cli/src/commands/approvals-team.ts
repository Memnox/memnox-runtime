import type { FlowItem } from '../flow';
import { TONE } from '../flow';
import { teamHeld, type PersonCredential, type TeamHeld } from '../sync/person';

/**
 * The questions a workspace routed to the person signed in here, read beside what this machine
 * holds so `memnox approvals` is everything waiting on them in one list.
 */

/** What the team routed here, or why it could not be read, which is said rather than hidden. */
export async function readTeam(
  person: PersonCredential | null,
): Promise<{ team: TeamHeld[]; failed: string | null }> {
  if (person === null) return { team: [], failed: null };
  try {
    return { team: await teamHeld(person), failed: null };
  } catch (err) {
    return { team: [], failed: err instanceof Error ? err.message : String(err) };
  }
}

/** "Codex on build-box", with the team's wording when it was widened to more people. */
export function teamItem(held: TeamHeld): FlowItem {
  const machine = held.machineLabel ?? held.machineId;
  const needs = held.approvalsNeeded > 1 ? `, needs ${held.approvalsNeeded} people` : '';
  return {
    tone: TONE.WARN,
    text: `${held.id}  ${held.agent} on ${machine} wants to ${held.summary ?? held.operation}`,
    detail: [
      `${held.escalated ? 'asked of your team' : 'asked of you'}${needs}`,
      held.reason,
    ],
  };
}

/** Counts, the same way every other door says them: "3 waiting: 2 here, 1 from your team". */
export function countLine(here: number, team: number): string {
  const total = here + team;
  if (team === 0) return `${total} waiting here`;
  if (here === 0) return `${total} waiting from your team`;
  return `${total} waiting: ${here} here, ${team} from your team`;
}
