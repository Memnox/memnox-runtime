import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deliveryRow, RunTerminals, SessionHosts } from '@memnox/core';
import { withEvents } from '../src/event-store';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { sessionsTool } from '../src/session-tools/sessions-tool';

const NOW = new Date('2026-10-15T05:50:00.000Z');
/** A pid nothing on this machine can hold, so its run reads as over. */
const GONE_PID = 2 ** 22 + 7;

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-launched-'));
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

type Row = {
  session: string;
  agent: string;
  repositories: string[];
  started: string;
  runningIn?: string;
};

describe('a session memnox run launched a moment ago', () => {
  it('is counted before its agent fires a hook, under the agent and folder the run noted', async () => {
    const deps = await depsAt();
    await new RunTerminals(deps.home).note({
      sessionId: 'ses_fresh',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Terminal',
      cwd: '/Users/ana/code/shop',
      startedAt: '2026-10-15T05:49:00.000Z',
    });
    const rows = (await sessionsTool(deps, {})) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session: 'ses_fresh',
      agent: 'claude-code',
      repositories: ['/Users/ana/code/shop'],
      started: '2026-10-15T05:49:00.000Z',
      runningIn: 'Terminal',
    });
  });

  it('is left out once its run has ended', async () => {
    const deps = await depsAt();
    await new RunTerminals(deps.home).note({
      sessionId: 'ses_over',
      agent: 'claude-code',
      pid: GONE_PID,
      cwd: '/Users/ana/code/shop',
      startedAt: '2026-10-15T05:49:00.000Z',
    });
    expect(await sessionsTool(deps, {})).toEqual([]);
  });
});

describe('a session the voice only typed into', () => {
  it('is no agent session, and never working, when nothing but deliveries were recorded in it', async () => {
    const deps = await depsAt();
    await withEvents(deps.home, (store) =>
      store.append(
        deliveryRow({
          sessionId: 'app_iterm',
          agent: 'iTerm',
          text: 'run the tests',
          outcome: 'typed',
          at: '2026-10-15T05:49:30.000Z',
        }),
      ),
    );
    const rows = (await sessionsTool(deps, {})) as (Row & {
      state: string;
      notAnAgent?: string;
    })[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notAnAgent).toContain('voice typing');
    expect(rows[0]?.state).not.toBe('working');
  });

  it('counts a delivery into a real session as the person speaking, not the agent working', async () => {
    const deps = await depsAt();
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_real',
      agent: 'claude-code',
      pid: 2 ** 22 + 9,
      seenAt: '2026-10-15T04:00:00.000Z',
    });
    await withEvents(deps.home, async (store) => {
      await store.append({
        ...deliveryRow({
          sessionId: 'ses_real',
          agent: 'claude-code',
          text: 'x',
          outcome: 'typed',
          at: '2026-10-15T04:30:00.000Z',
        }),
        actorType: 'agent',
        operation: 'shell.exec',
        principal: 'claude-code',
      });
      await store.append(
        deliveryRow({
          sessionId: 'ses_real',
          agent: 'claude-code',
          text: 'carry on',
          outcome: 'typed',
          at: '2026-10-15T05:49:30.000Z',
        }),
      );
    });
    const rows = (await sessionsTool(deps, {})) as (Row & {
      state: string;
      lastActive: string;
      notAnAgent?: string;
    })[];
    const real = rows.find((each) => each.session === 'ses_real');
    expect(real?.notAnAgent).toBeUndefined();
    expect(real?.lastActive).toBe('2026-10-15T04:30:00.000Z');
  });
});
