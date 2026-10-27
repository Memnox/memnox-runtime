import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  POST_KIND,
  SessionPauses,
  SessionPosts,
  SessionTurns,
  SqliteEventStore,
  TOOL_CLASS,
  type MemnoxEvent,
} from '@memnox/core';
import { WaitingFeed } from '../src/daemon/waiting-feed';

const NOW = '2026-10-08T07:00:00.000Z';

const row = (at: string, over: Partial<MemnoxEvent> = {}): MemnoxEvent => ({
  id: `evt_${at}`,
  schemaVersion: EVENT_SCHEMA_VERSION,
  at,
  sessionId: 'ses_night',
  agent: 'claude-code',
  actorType: ACTOR_TYPE.AGENT,
  surface: EVENT_SURFACE.SHELL,
  operation: 'npm.test',
  class: TOOL_CLASS.READ,
  effect: DECISION_EFFECT.ALLOW,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'ran',
  exitCode: 0,
  ...over,
});

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-feed-posts-'));
}

describe('what a person away hears that is not a question', () => {
  it('tells a session the breaker stopped, so the phone can resume it', async () => {
    const dir = await home();
    await new SessionPauses(dir).pause({
      sessionId: 'ses_loop',
      signal: 'error-loop',
      reason: 'npm.test has failed the same way 5 times',
      reached: 5,
      ceiling: 5,
      pausedAt: '2026-10-08T03:00:00.000Z',
    });
    const events = await new WaitingFeed(dir).current(NOW);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'paused', subject: 'ses_loop' }),
    );
  });

  it('tells a session that is struggling', async () => {
    const dir = await home();
    await new SessionPosts(dir).put({
      kind: POST_KIND.STRUGGLING,
      sessionId: 'ses_night',
      agent: 'claude-code',
      summary: 'claude-code is struggling: 3 failures it has not got past.',
      at: '2026-10-08T04:00:00.000Z',
    });
    const [event] = await new WaitingFeed(dir).current(NOW);
    expect(event).toMatchObject({ kind: 'notice', notice: 'struggling' });
  });

  it('tells a long turn that finished, with what it came to', async () => {
    const dir = await home();
    const turns = new SessionTurns(dir);
    await turns.prompted('ses_night', 'claude-code', '2026-10-07T22:00:00.000Z');
    await turns.ended('ses_night', 'claude-code', '2026-10-08T01:42:00.000Z');
    const store = SqliteEventStore.forHome(dir);
    await store.append(row('2026-10-07T23:00:00.000Z', { exitCode: 1 }));
    await store.append(row('2026-10-08T01:00:00.000Z'));
    store.close();

    const [event] = await new WaitingFeed(dir).current(NOW);
    expect(event).toMatchObject({ kind: 'notice', notice: 'finished' });
    expect(event?.summary).toContain('worked 4h and is waiting on you');
    expect(event?.summary).toContain('asked you nothing');
    expect(event?.summary).toContain('tests: npm test passed');
    expect(event?.summary).toContain('recovered: 1 failure(s) later got past');
  });

  it('says nothing about a short turn, or one the person already came back to', async () => {
    const dir = await home();
    const turns = new SessionTurns(dir);
    await turns.prompted('ses_short', 'claude-code', '2026-10-08T06:50:00.000Z');
    await turns.ended('ses_short', 'claude-code', '2026-10-08T06:55:00.000Z');
    await turns.prompted('ses_back', 'claude-code', '2026-10-08T01:00:00.000Z');
    await turns.ended('ses_back', 'claude-code', '2026-10-08T03:00:00.000Z');
    await turns.prompted('ses_back', 'claude-code', '2026-10-08T06:00:00.000Z');
    expect(await new WaitingFeed(dir).current(NOW)).toEqual([]);
  });
});
