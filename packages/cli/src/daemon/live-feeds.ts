import type { DaemonEvent } from '@memnox/core';
import { ActivityFeed } from './activity-feed';
import { WorkFeed } from './work-feed';
import type { NoticeWatcher } from './notice-watch';
import { ACTIVITY_INTERVAL_MS, NOTICE_INTERVAL_MS } from './voice.constants';

/**
 * The ledger read for subscribers while somebody listens: news every few seconds, and the rows a
 * live timeline shows once a second at most. Started by the first subscriber, idle while nobody is.
 */

interface LiveFeedsDeps {
  home: string;
  now: () => string;
  log: (message: string) => void;
  notices: NoticeWatcher;
  tell: (event: DaemonEvent) => void;
  listening: () => boolean;
  noticeIntervalMs?: number;
  activityIntervalMs?: number;
}

export class LiveFeeds {
  private noticeTimer: ReturnType<typeof setInterval> | null = null;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  /** Null while nobody listens, so the next listener hears what happens from then, not a backlog. */
  private activity: ActivityFeed | null = null;
  private work: WorkFeed | null = null;

  /** Both timers, once, from the first subscriber; one is no reason to keep a daemon alive that was asked to stop. */
  start(deps: LiveFeedsDeps): void {
    if (this.noticeTimer !== null) return;
    deps.notices.followCollisions(deps.tell, deps.now);
    this.noticeTimer = setInterval(
      () => read(deps, () => deps.notices.look(deps.now()), 'news'),
      deps.noticeIntervalMs ?? NOTICE_INTERVAL_MS,
    );
    this.activityTimer = setInterval(
      () => this.lookForActivity(deps),
      deps.activityIntervalMs ?? ACTIVITY_INTERVAL_MS,
    );
    this.noticeTimer.unref();
    this.activityTimer.unref();
  }

  close(): void {
    for (const timer of [this.noticeTimer, this.activityTimer])
      if (timer !== null) clearInterval(timer);
    this.noticeTimer = null;
    this.activityTimer = null;
  }

  private lookForActivity(deps: LiveFeedsDeps): void {
    if (!deps.listening()) {
      this.activity = null;
      this.work = null;
      return;
    }
    const work = this.work ?? new WorkFeed(deps.home);
    this.work = work;
    read(deps, () => work.look(), 'agent work');
    const feed = this.activity ?? new ActivityFeed(deps.home, deps.now());
    this.activity = feed;
    read(
      deps,
      async () => {
        const event = await feed.look(deps.now());
        return event === null ? [] : [event];
      },
      'activity',
    );
  }
}

function read(
  deps: LiveFeedsDeps,
  look: () => Promise<DaemonEvent[]>,
  what: string,
): void {
  if (!deps.listening()) return;
  look()
    .then((events) => events.forEach((event) => deps.tell(event)))
    .catch((err: unknown) => deps.log(`could not look for ${what}: ${String(err)}`));
}
