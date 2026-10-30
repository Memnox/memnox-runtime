import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEventOf,
  DAEMON_EVENT,
  MOST_LIVE_ACTIVITY_ROWS,
  phoneHears,
  REMOTE_CAPABILITY,
  SqliteEventStore,
  type MemnoxEvent,
} from '@memnox/core';
import { ActivityFeed } from '../src/daemon/activity-feed';

/**
 * The live timeline: a row the activity view shows is sent to subscribers as it is written, by
 * name only, a burst as one bounded event, and only to a phone that may see activity.
 */

const STARTED = '2026-10-30T09:00:00.000Z';

function row(id: string, at: string, fields: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id,
    schemaVersion: 1,
    at,
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'mcp',
    operation: 'mcp.github.create_issue',
    target: 'github',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    argsDigest: 'sha256:abc',
    ...fields,
  } as MemnoxEvent;
}

function secondsIn(n: number): string {
  return new Date(Date.parse(STARTED) + n * 1_000).toISOString();
}

describe('a burst of activity as one event', () => {
  it('carries names only, never a digest of what was sent', () => {
    const event = activityEventOf([row('e1', secondsIn(1))], secondsIn(2));

    expect(event).toMatchObject({ kind: DAEMON_EVENT.ACTIVITY, subject: 'e1' });
    expect(event?.activityRows).toEqual([
      {
        id: 'e1',
        at: secondsIn(1),
        agent: 'claude-code',
        operation: 'mcp.github.create_issue',
        effect: 'allow',
        target: 'github',
      },
    ]);
    expect(JSON.stringify(event)).not.toContain('sha256');
  });

  it('carries the newest rows and counts the rest, so a burst is bounded', () => {
    const burst = Array.from({ length: 30 }, (_, index) =>
      row(`e${String(index).padStart(2, '0')}`, secondsIn(index)),
    );
    const event = activityEventOf(burst, secondsIn(40));

    expect(event?.activityRows).toHaveLength(MOST_LIVE_ACTIVITY_ROWS);
    expect(event?.activityRows?.[0]?.id).toBe('e10');
    expect(event?.activityMissed).toBe(10);
  });

  it('is nothing when nothing was written', () => {
    expect(activityEventOf([], secondsIn(1))).toBeNull();
  });

  it('reaches a phone only while it may see', () => {
    expect(phoneHears(DAEMON_EVENT.ACTIVITY, [REMOTE_CAPABILITY.SEE])).toBe(true);
    expect(phoneHears(DAEMON_EVENT.ACTIVITY, [REMOTE_CAPABILITY.ASK])).toBe(false);
  });
});

describe('the ledger read for a live timeline', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-live-activity-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function write(rows: MemnoxEvent[]): Promise<void> {
    const store = SqliteEventStore.forHome(home);
    for (const each of rows) await store.append(each);
    store.close();
  }

  it('sends what was written since it started, once each, and nothing from before', async () => {
    await write([row('before', secondsIn(-60))]);
    const feed = new ActivityFeed(home, STARTED);
    await write([row('first', secondsIn(1))]);

    const first = await feed.look(secondsIn(2));
    expect(first?.activityRows?.map((each) => each.id)).toEqual(['first']);

    expect(await feed.look(secondsIn(3))).toBeNull();

    await write([row('second', secondsIn(4))]);
    const second = await feed.look(secondsIn(5));
    expect(second?.activityRows?.map((each) => each.id)).toEqual(['second']);
  });
});
