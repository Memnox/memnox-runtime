import {
  DAEMON_EVENT,
  UNNAMED_AGENT,
  type DaemonEvent,
  type DrivenBy,
  type VoiceHolder,
  type VoiceOn,
} from '@memnox/core';

/**
 * Which paired phone holds the voice: that phone speaks every event and the Mac only shows it.
 * A phone holds it while its app is open, while it drives, while a question from it is in flight,
 * and for a while after the last of those, unless the person spoke to the Mac since the phone was last used.
 */

/** Long enough that a follow up and what the agent raises from that turn stay on the phone. */
export const VOICE_GRACE_MS = 30_000;

/** What a phone has done lately, as the rule reads it. */
export interface PhoneActivity {
  deviceId: string;
  name: string;
  /** When its live drive grant ends, absent when it does not drive. */
  drivingUntil?: string;
  /** Its questions still being answered. */
  asking: number;
  /** Its live subscribe streams; iOS drops one within seconds of the app leaving the front, so one live means the app is open. */
  subscribed: number;
  /** When its last question or its last stream ended, which starts the grace. */
  endedAt?: string;
  /** The latest thing it did, which decides between two phones that both qualify. */
  lastActiveAt: string;
  /** The person spoke to the Mac since this phone was last used, so it holds nothing until it is used again. */
  yielded?: boolean;
  /** Its app left the screen and let the voice go, so it holds nothing until it is back in front or asks. */
  letGo?: boolean;
}

function qualifies(phone: PhoneActivity, now: number): boolean {
  if (phone.yielded === true || phone.letGo === true) return false;
  if (phone.asking > 0 || phone.subscribed > 0) return true;
  if (phone.drivingUntil !== undefined && Date.parse(phone.drivingUntil) > now)
    return true;
  return phone.endedAt !== undefined && now - Date.parse(phone.endedAt) < VOICE_GRACE_MS;
}

/** The phone that holds the voice now, the most recently active when several qualify, or null for the Mac. */
export function voiceHolder(
  phones: readonly PhoneActivity[],
  now: string,
): VoiceHolder | null {
  const at = Date.parse(now);
  const holder = phones
    .filter((phone) => qualifies(phone, at))
    .reduce<PhoneActivity | null>(
      (best, phone) =>
        best === null || Date.parse(phone.lastActiveAt) > Date.parse(best.lastActiveAt)
          ? phone
          : best,
      null,
    );
  return holder === null ? null : { deviceId: holder.deviceId, name: holder.name };
}

/** The next moment the answer may change with nothing else happening, or null when only an event changes it. */
export function nextExpiry(phones: readonly PhoneActivity[], now: string): number | null {
  const at = Date.parse(now);
  const ends = phones.flatMap((phone) => [
    ...(phone.drivingUntil === undefined ? [] : [Date.parse(phone.drivingUntil)]),
    ...(phone.endedAt === undefined ? [] : [Date.parse(phone.endedAt) + VOICE_GRACE_MS]),
  ]);
  const ahead = ends.filter((end) => end > at);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

/** Where the voice went, for the Mac island to say in a plain line. */
export function voiceOnNotice(voiceOn: VoiceOn, at: string): DaemonEvent {
  return {
    kind: DAEMON_EVENT.NOTICE,
    subject: 'voice_on',
    agent: UNNAMED_AGENT,
    summary: voiceOn.holding ? `Talking on ${voiceOn.name}` : 'Back on the Mac',
    at,
    voiceOn,
  };
}

interface Phone {
  id: string;
  name: string;
}

/** The phones' activity kept as it happens, telling `changed` each time the holder moves. */
export class VoiceHold {
  private readonly phones = new Map<string, PhoneActivity>();
  private current: VoiceHolder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly now: () => string,
    private readonly changed: (voiceOn: VoiceOn) => void,
  ) {}

  holder(): VoiceHolder | null {
    return this.current;
  }

  /** Whether that phone's app is open with a live stream, so what waits reaches it there rather than by a wake. */
  listening(deviceId: string): boolean {
    return (this.phones.get(deviceId)?.subscribed ?? 0) > 0;
  }

  /** An event as it leaves the daemon, naming the phone that holds the voice so the Mac shows it without a sound. */
  stamp(event: DaemonEvent): DaemonEvent {
    return this.current === null ? event : { ...event, heardOn: this.current };
  }

  /** A drive grant began, with its until, or ended, without one. */
  driven(drivenBy: DrivenBy): void {
    if (drivenBy.until !== undefined) {
      const activity = this.touch({ id: drivenBy.deviceId, name: drivenBy.name });
      activity.drivingUntil = drivenBy.until;
      delete activity.yielded;
      delete activity.letGo;
    } else {
      const activity = this.phones.get(drivenBy.deviceId);
      if (activity === undefined) return;
      delete activity.drivingUntil;
    }
    this.settle();
  }

  began(phone: Phone): void {
    const activity = this.touch(phone);
    activity.asking += 1;
    delete activity.yielded;
    delete activity.letGo;
    this.settle();
  }

  /** Its app opened a stream, which holds the voice for as long as the stream lives. */
  subscribed(phone: Phone): void {
    const known = this.phones.get(phone.id);
    // A stream renewed within the grace is the same visit, so only the app opened afresh takes the voice back from the Mac.
    const fresh =
      known === undefined ||
      (known.subscribed === 0 &&
        (known.endedAt === undefined ||
          Date.parse(this.now()) - Date.parse(known.endedAt) >= VOICE_GRACE_MS));
    const activity = this.touch(phone);
    activity.subscribed += 1;
    if (fresh) delete activity.yielded;
    // A new stream means the app is in front again, so a voice it let go in the background is its again.
    delete activity.letGo;
    this.settle();
  }

  /** It subscribed again over a stream still open, which takes back only a voice it let go itself, never one the Mac took. */
  renewed(deviceId: string): void {
    const activity = this.phones.get(deviceId);
    if (activity?.letGo !== true) return;
    delete activity.letGo;
    this.settle();
  }

  /** Its app left the screen and gave the voice up, so the Mac speaks at once rather than after a stream iOS may keep looking alive. */
  released(deviceId: string): void {
    const activity = this.phones.get(deviceId);
    if (activity === undefined || activity.letGo === true) return;
    activity.letGo = true;
    this.settle();
  }

  /** The person spoke to the Mac, so the Mac answers and says what comes next until a phone is used again. */
  macTookBack(): void {
    for (const activity of this.phones.values()) activity.yielded = true;
    this.settle();
  }

  /** Its stream ended, which starts the grace rather than giving the voice back at once. */
  unsubscribed(deviceId: string): void {
    const activity = this.phones.get(deviceId);
    if (activity === undefined || activity.subscribed === 0) return;
    activity.subscribed -= 1;
    activity.endedAt = this.now();
    this.settle();
  }

  /** Ignored once the phone is forgotten, so a question outliving its revoke never takes the voice back. */
  ended(deviceId: string): void {
    const activity = this.phones.get(deviceId);
    if (activity === undefined) return;
    activity.asking = Math.max(0, activity.asking - 1);
    activity.endedAt = this.now();
    activity.lastActiveAt = activity.endedAt;
    this.settle();
  }

  /** It was revoked, so it holds nothing from now on. */
  forget(deviceId: string): void {
    if (!this.phones.delete(deviceId)) return;
    this.settle();
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.phones.clear();
  }

  private touch(phone: Phone): PhoneActivity {
    const now = this.now();
    const found = this.phones.get(phone.id);
    if (found !== undefined) {
      found.name = phone.name;
      found.lastActiveAt = now;
      return found;
    }
    const created: PhoneActivity = {
      deviceId: phone.id,
      name: phone.name,
      asking: 0,
      subscribed: 0,
      lastActiveAt: now,
    };
    this.phones.set(phone.id, created);
    return created;
  }

  /** Reads the rule again and sets a timer for the next expiry, so the voice comes back with no other event. */
  private settle(): void {
    const now = this.now();
    const all = [...this.phones.values()];
    const next = voiceHolder(all, now);
    const before = this.current;
    this.current = next;
    if (next !== null && next.deviceId !== before?.deviceId) {
      this.changed({ ...next, holding: true });
    } else if (next === null && before !== null) {
      this.changed({ ...before, holding: false });
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const expiry = nextExpiry(all, now);
    if (expiry === null) return;
    this.timer = setTimeout(() => this.settle(), expiry - Date.parse(now));
    // An expiry ahead is never a reason to keep a daemon alive that was asked to stop.
    this.timer.unref();
  }
}
