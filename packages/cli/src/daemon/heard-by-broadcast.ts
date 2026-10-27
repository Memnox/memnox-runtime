import type { DaemonEvent } from '@memnox/core';
import type { Peer } from './socket-write';

/** Enough for hours of news, so a subscriber that never sees the feed list one cannot grow without end. */
const MOST_REMEMBERED = 200;

/**
 * What each subscriber already heard as it happened. A long turn that finished is broadcast at once
 * and then listed by the feed under the same subject, and without this it was told twice.
 */
export class HeardByBroadcast {
  private readonly heard = new WeakMap<Peer, Set<string>>();

  note(socket: Peer, subject: string): void {
    const heard = this.heard.get(socket) ?? new Set<string>();
    heard.add(subject);
    if (heard.size > MOST_REMEMBERED) heard.delete(heard.values().next().value ?? '');
    this.heard.set(socket, heard);
  }

  /** Counts as told what a subscriber already heard, so the feed neither repeats it nor settles it early. */
  fold(
    subscribers: ReadonlyMap<Peer, Set<string>>,
    waiting: readonly DaemonEvent[],
  ): void {
    for (const [socket, told] of subscribers) {
      const heard = this.heard.get(socket);
      if (heard === undefined) continue;
      for (const event of waiting)
        if (heard.delete(event.subject)) told.add(event.subject);
    }
  }
}
