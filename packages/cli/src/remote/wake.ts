import type { DeviceRecord } from '@memnox/core';

/**
 * When to wake a phone: something new waits on its person and its app follows no events, which a live
 * tunnel alone does not prove, since a turn asked from the island runs one with the app in the background.
 * The push carries generic words only, and the phone reads the detail once it connects.
 */

/** One wake a minute per phone at most, however much arrives. */
const WAKE_SPACING_MS = 60_000;

export class PhoneWakes {
  /** By phone, what it was woken for or heard on its own stream, so each subject wakes it once. */
  private readonly told = new Map<string, Set<string>>();
  private readonly lastWake = new Map<string, number>();

  /** The phones to wake for what waits now, given which have their app following events. */
  due(
    waiting: readonly string[],
    phones: readonly DeviceRecord[],
    input: { live: (deviceId: string) => boolean; now: number },
  ): DeviceRecord[] {
    const still = new Set(waiting);
    const due: DeviceRecord[] = [];
    for (const phone of phones) {
      if (phone.revokedAt !== undefined || phone.mailbox === undefined) continue;
      const told = new Set(
        [...(this.told.get(phone.id) ?? [])].filter((subject) => still.has(subject)),
      );
      this.told.set(phone.id, told);
      const fresh = waiting.some((subject) => !told.has(subject));
      // An app following events hears it on its stream, so it counts as told there.
      if (input.live(phone.id)) {
        this.told.set(phone.id, still);
        continue;
      }
      // Left untold inside the spacing, so the next pass after it still wakes the phone for it.
      if (!fresh || input.now - (this.lastWake.get(phone.id) ?? 0) < WAKE_SPACING_MS)
        continue;
      this.lastWake.set(phone.id, input.now);
      this.told.set(phone.id, still);
      due.push(phone);
    }
    return due;
  }
}
