import { stat } from 'node:fs/promises';
import { activityEventOf, databasePathFor, type DaemonEvent } from '@memnox/core';
import { withEvents } from '../event-store';

/**
 * The ledger's new rows for a live timeline, read while somebody subscribes. A look reads only
 * when the database moved, at most once a tick, and a burst comes back as one bounded event.
 */

/** Rows read in one look; a burst past this is counted as missed, and a screen pages for it. */
const MOST_ROWS_READ = 500;

/** How far back each look reads again, since a writer can stamp a row a moment before it lands. */
const OVERLAP_MS = 5_000;

export class ActivityFeed {
  /** Ids already sent, by when they happened, kept only for the overlap. */
  private readonly sent = new Map<string, string>();
  private lastSeen: string;
  /** The database's size and time at the last look, so an idle ledger costs a stat and no query. */
  private stamp = '';

  constructor(
    private readonly home: string,
    private readonly started: string,
  ) {
    this.lastSeen = started;
  }

  /** Every row written since the last look, as one event, or null when nothing was. */
  async look(now: string): Promise<DaemonEvent | null> {
    const stamp = await this.stampOf();
    if (stamp === this.stamp) return null;
    this.stamp = stamp;
    const since = new Date(Date.parse(this.lastSeen) - OVERLAP_MS).toISOString();
    const read = await withEvents(this.home, (store) =>
      store.query({ since, limit: MOST_ROWS_READ }),
    );
    // Only what happened while somebody listened: a history before that is a page, not news.
    const fresh = read.filter(
      (event) => event.at >= this.started && !this.sent.has(event.id),
    );
    for (const event of fresh) {
      this.sent.set(event.id, event.at);
      if (event.at > this.lastSeen) this.lastSeen = event.at;
    }
    this.forgetBefore(since);
    return activityEventOf(fresh, now);
  }

  private forgetBefore(since: string): void {
    for (const [id, at] of this.sent) if (at < since) this.sent.delete(id);
  }

  /** The ledger and its write ahead log as one stamp; a missing file is a stamp of its own. */
  private async stampOf(): Promise<string> {
    const path = databasePathFor(this.home);
    const parts = await Promise.all(
      [path, `${path}-wal`].map((file) =>
        stat(file).then(
          (info) => `${info.size}:${info.mtimeMs}`,
          // No log yet is a state like any other, and the next write changes it.
          () => 'none',
        ),
      ),
    );
    return parts.join('|');
  }
}
