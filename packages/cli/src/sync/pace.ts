import { secondsToMs } from '@memnox/core';

// How often the sync loop runs, and what brings a pass forward.

/** The fallback for a lost beat, since the control plane beats a machine when a rule or a condition changes. */
export const HEARTBEAT_MS = secondsToMs(60);

/** Where it backs off to while the control plane is unreachable. */
export const BACKOFF_MS = secondsToMs(15 * 60);

/**
 * How often this looks while an agent is stopped on a question. The heartbeat carries a
 * held call both ways, so a minute between passes would spend the whole hold window.
 */
const HELD_POLL_MS = secondsToMs(2);

/**
 * How often a held call is polled while the relay link is up. The control plane beats this
 * machine over the relay when an answer is stored, so this is only the fallback for a lost beat.
 */
export const RELAYED_HELD_POLL_MS = secondsToMs(30);

/**
 * The soonest activity brings a pass forward. Every tool call marks it, so two seconds
 * was nine requests in ten across a fleet; a held question keeps the two second poll.
 */
const ACTIVE_PASS_MS = secondsToMs(10);

interface WaitInput {
  home: string;
  idleMs: number;
  /** When the pass began, so activity after it wakes the loop. */
  since: number;
  sleep: (ms: number) => Promise<void>;
  /** The ids of the calls held here now. */
  holding: (home: string) => Promise<readonly string[]>;
  active: (home: string, since: number) => Promise<boolean>;
  /** The held calls the last pass already carried up, so only a new one needs a pass at once. */
  carried?: ReadonlySet<string>;
  /** Whether the relay link is up, so the control plane can beat this machine when it answers. */
  relayed?: () => boolean;
  /** Takes a beat that arrived since it was last asked. */
  beaten?: () => boolean;
}

/** How long the loop waited, and whether a beat ended it, which is the one wait that must pull. */
interface Due {
  waited: number;
  beaten: boolean;
}

/**
 * Waits until the next pass is due, leaving early when the control plane beats this machine,
 * when an agent here stops on a question, or when one has done something for a while.
 */
export async function waitUntilDue(input: WaitInput): Promise<Due> {
  let waited = 0;
  while (waited < input.idleMs) {
    const step = Math.min(HELD_POLL_MS, input.idleMs - waited);
    await input.sleep(step);
    waited += step;
    // Honoured whether or not anything is held, since a beat also means a rule or a freeze changed.
    if (input.beaten?.() ?? false) return { waited, beaten: true };
    const held = await input.holding(input.home);
    if (held.length > 0 && heldPassDue(input, held, waited)) {
      return { waited, beaten: false };
    }
    if (waited >= ACTIVE_PASS_MS && (await input.active(input.home, input.since))) {
      return { waited, beaten: false };
    }
  }
  return { waited, beaten: false };
}

/**
 * A held call is polled every two seconds unless the relay link is up, where a beat or a call
 * not yet carried up brings the pass and the slow poll is only the fallback.
 */
function heldPassDue(input: WaitInput, held: readonly string[], waited: number): boolean {
  if (!(input.relayed?.() ?? false)) return true;
  if (held.some((id) => !(input.carried?.has(id) ?? false))) return true;
  return waited >= RELAYED_HELD_POLL_MS;
}
