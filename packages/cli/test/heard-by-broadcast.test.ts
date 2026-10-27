import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT, decodeResponse, type DaemonEvent } from '@memnox/core';
import { HeardByBroadcast } from '../src/daemon/heard-by-broadcast';
import { sendWaiting } from '../src/daemon/origin-routing';
import type { Peer } from '../src/daemon/socket-write';

/** News broadcast as it happens and then listed by the feed is told once. */

const NOW = '2026-10-15T04:29:47.000Z';

class Mac implements Peer {
  destroyed = false;
  subjects: string[] = [];
  write(line: string): boolean {
    const event = decodeResponse(line.trim())?.event;
    if (event !== undefined) this.subjects.push(`${event.kind} ${event.subject}`);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

const FINISHED: DaemonEvent = {
  kind: DAEMON_EVENT.NOTICE,
  notice: 'finished',
  subject: 'ntc_finished_ses_1_mv91i6xv',
  agent: 'claude-code',
  summary: 'Claude Code finished a turn of about 20 minutes and is waiting on you.',
  at: NOW,
};

function pass(subscribers: Map<Peer, Set<string>>, waiting: DaemonEvent[]): void {
  sendWaiting(subscribers, waiting, {
    claimed: new Set(),
    now: NOW,
    phoneOf: () => undefined,
    originOf: () => undefined,
    stamp: (event) => event,
  });
}

describe('news heard as it happened', () => {
  it('is not told again when the feed lists it, and settles once it leaves', () => {
    const mac = new Mac();
    const subscribers = new Map<Peer, Set<string>>([[mac, new Set()]]);
    const heard = new HeardByBroadcast();
    heard.note(mac, FINISHED.subject);

    heard.fold(subscribers, [FINISHED]);
    pass(subscribers, [FINISHED]);
    expect(mac.subjects).toEqual([]);

    heard.fold(subscribers, []);
    pass(subscribers, []);
    expect(mac.subjects).toEqual([`settled ${FINISHED.subject}`]);
  });

  it('still tells the feed news nobody broadcast', () => {
    const mac = new Mac();
    const subscribers = new Map<Peer, Set<string>>([[mac, new Set()]]);
    new HeardByBroadcast().fold(subscribers, [FINISHED]);
    pass(subscribers, [FINISHED]);
    expect(mac.subjects).toEqual([`notice ${FINISHED.subject}`]);
  });
});
