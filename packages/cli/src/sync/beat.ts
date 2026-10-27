/**
 * The beat the control plane sends over the relay when an answer waits for this machine or what
 * it pulls changed, and the sleep it cuts short, shared by the relay link and the sync loop.
 */

/** The soonest one beat may follow the last: a single beat is acted on at once, and a burst is four passes a second at most. */
export const BEAT_FLOOR_MS = 250;

export class HeartbeatBeats {
  private pending = false;
  private wake: (() => void) | null = null;
  private takenAt = Number.NEGATIVE_INFINITY;
  private link: () => boolean = () => false;

  constructor(private readonly now: () => number = Date.now) {}

  /** The relay link, once one exists, so the loop knows whether a beat can reach it. */
  linkedBy(isUp: () => boolean): void {
    this.link = isUp;
  }

  /** True while the relay link is open, which is the only time a beat can arrive. */
  linked(): boolean {
    return this.link();
  }

  /** Kept rather than acted on here, so a beat during a pass is honoured by the next wait. */
  beat(): void {
    this.pending = true;
    const wake = this.wake;
    if (wake === null) return;
    const timer = setTimeout(wake, this.cooldown());
    timer.unref();
  }

  /** Whether a beat arrived since this was last asked, forgetting it either way. */
  take(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    this.takenAt = this.now();
    return true;
  }

  /** Ends early when a beat arrives, though never sooner than the floor after the last one. */
  sleep(ms: number): Promise<void> {
    if (this.pending) return wait(Math.min(ms, this.cooldown()));
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  private cooldown(): number {
    return Math.max(0, this.takenAt + BEAT_FLOOR_MS - this.now());
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
