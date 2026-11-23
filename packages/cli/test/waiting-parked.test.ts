import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT, PendingApprovals, type HoldRequest } from '@memnox/core';
import { WaitingFeed } from '../src/daemon/waiting-feed';

/**
 * A question nobody answered in time is kept for later while the agent carries on, and the apps
 * are told which, so they can list it apart from a call an agent is blocked on.
 */

const NOW = '2026-11-23T10:00:00.000Z';
const LATER = '2026-11-23T10:05:00.000Z';
const DAY = '2026-11-24T10:00:00.000Z';
const MINUTE = 60_000;

const call = (fingerprint: string): HoldRequest => ({
  sessionId: 'ses_parked',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint,
  reason: 'pushing to main needs a person',
});

describe('the waiting list', () => {
  it('marks a call kept for later, and only that one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-parked-'));
    const approvals = new PendingApprovals(home);
    const blocked = await approvals.raise(call('aaa111'), NOW, 10 * MINUTE);
    const kept = await approvals.raise(call('bbb222'), NOW, MINUTE);
    await approvals.park(kept.id, LATER, DAY);

    const held = (await new WaitingFeed(home).current(LATER)).filter((each) => each.kind === DAEMON_EVENT.HELD);
    expect(held.find((each) => each.subject === kept.id)?.parkedAt).toBe(LATER);
    expect(held.find((each) => each.subject === blocked.id)?.parkedAt).toBeUndefined();
  });
});
