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
  SessionPosts,
  SqliteEventStore,
  TOOL_CLASS,
  type MemnoxEvent,
} from '@memnox/core';
import { strainHolding } from '../src/breaker-seam';

const SESSION = 'ses_night';

const run = (minute: number, operation: string, exitCode: number): MemnoxEvent => ({
  id: `evt_${minute}`,
  schemaVersion: EVENT_SCHEMA_VERSION,
  at: new Date(Date.parse('2026-10-07T22:00:00.000Z') + minute * 60_000).toISOString(),
  sessionId: SESSION,
  agent: 'claude-code',
  actorType: ACTOR_TYPE.AGENT,
  surface: EVENT_SURFACE.SHELL,
  operation,
  class: TOOL_CLASS.READ,
  effect: DECISION_EFFECT.ALLOW,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'ran',
  exitCode,
});

async function machine(rows: readonly MemnoxEvent[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-strain-post-'));
  const store = SqliteEventStore.forHome(home);
  for (const row of rows) await store.append(row);
  store.close();
  return home;
}

describe('a person away hears when a session starts struggling, and not after', () => {
  it('posts once when failures stand, naming the agent and what fails', async () => {
    const home = await machine([
      run(1, 'npm.test', 1),
      run(2, 'npm.test', 1),
      run(3, 'npm.test', 1),
    ]);
    const strain = await strainHolding(home, SESSION, 'Claude');
    expect(strain?.unresolved).toBe(3);
    const post = await new SessionPosts(home).read(POST_KIND.STRUGGLING, SESSION);
    expect(post?.summary).toContain('Claude is struggling: this session has 3 failures');
    await strainHolding(home, SESSION, 'Claude');
    expect(await new SessionPosts(home).open(post?.at ?? '')).toHaveLength(1);
  });

  it('takes the post back once the agent got past it', async () => {
    const rows = [run(1, 'npm.test', 1), run(2, 'npm.test', 1), run(3, 'npm.test', 1)];
    const home = await machine(rows);
    await strainHolding(home, SESSION, 'Claude');
    const store = SqliteEventStore.forHome(home);
    await store.append(run(4, 'npm.test', 0));
    store.close();
    await strainHolding(home, SESSION, 'Claude');
    expect(await new SessionPosts(home).read(POST_KIND.STRUGGLING, SESSION)).toBeNull();
  });

  it('posts nothing for a session doing fine', async () => {
    const home = await machine([run(1, 'npm.test', 0)]);
    await strainHolding(home, SESSION, 'Claude');
    expect(await new SessionPosts(home).read(POST_KIND.STRUGGLING, SESSION)).toBeNull();
  });
});
