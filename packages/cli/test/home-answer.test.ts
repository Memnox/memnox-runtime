import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  Proposals,
  SqliteEventStore,
  type MemnoxEvent,
  type SessionCard,
} from '@memnox/core';
import { homeAnswer, type HomeStatus } from '../src/daemon/home-answer';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

const NOW = new Date('2026-10-06T15:00:00.000Z');

function event(over: Partial<MemnoxEvent>): MemnoxEvent {
  return {
    id: `evt_${over.at ?? ''}_${over.effect ?? ''}_${over.actorType ?? ''}`,
    schemaVersion: 1,
    at: '2026-10-06T10:00:00.000Z',
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'git',
    operation: 'git.push',
    target: 'feature/cart',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

/** Six pushes a person allowed, one refusal of a deploy, and a person's yes, all today. */
async function machine(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-home-'));
  const store = SqliteEventStore.forHome(home);
  for (let hour = 8; hour < 14; hour++) {
    await store.append(
      event({
        at: `2026-10-06T${String(hour).padStart(2, '0')}:00:00.000Z`,
        effect: 'ask',
        authorizedBy: 'ana',
      }),
    );
  }
  await store.append(
    event({ at: '2026-10-06T14:00:00.000Z', operation: 'deploy.run', effect: 'deny' }),
  );
  await store.append(
    event({ at: '2026-10-06T14:10:00.000Z', actorType: 'human', effect: 'allow' }),
  );
  store.close();
  return home;
}

const STATUS: HomeStatus = {
  mode: 'enforce',
  waiting: 2,
  agents: 3,
  hooked: ['claude-code'],
  unhooked: ['Codex', 'Cursor'],
  dormant: [{ name: 'aider' }],
};

const WORKING: SessionCard = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  agentName: 'Claude Code',
  task: 'fix the cart',
  state: 'working',
  thinking: false,
};

function input(home: string): Parameters<typeof homeAnswer>[2] {
  const deps: SessionToolDeps = {
    home,
    cwd: home,
    agent: 'memnox-operator',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
  return {
    views: {
      list: async () => [WORKING, { ...WORKING, sessionId: 'ses_2', state: 'idle' }],
      deps: () => deps,
    },
    now: NOW,
    status: async () => STATUS,
  };
}

describe('the home every surface opens on', () => {
  it('gathers waiting, working, today, ready and not covered from one record', async () => {
    const home = await machine();

    const answer = await homeAnswer(
      home,
      { id: 1, method: DAEMON_METHOD.HOME },
      input(home),
    );

    expect(answer.home).toMatchObject({
      mode: 'enforce',
      waiting: 2,
      working: [{ sessionId: 'ses_1', agentName: 'Claude Code', task: 'fix the cart' }],
      notCovered: { unprotected: 2, dormant: 1 },
    });
    expect(answer.home?.today).toMatchObject({ asked: 6, refused: 1, allowed: 1 });
    expect(answer.home?.ready).toMatchObject({
      action: 'git.push',
      approvals: 6,
      targets: ['feature/cart'],
    });
  });

  it('hands the ready action over only as a proposal the person still has to sign', async () => {
    const home = await machine();

    const answer = await homeAnswer(
      home,
      { id: 2, method: DAEMON_METHOD.HAND_OVER, action: 'git.push' },
      input(home),
    );
    const proposal = await new Proposals(home).read(answer.proposed ?? '');

    expect(answer.ok).toBe(true);
    expect(proposal?.change.kind).toBe('rules');
    expect(proposal?.answer).toBeUndefined();
  });

  it('refuses to hand over what was ever refused or not yet earned', async () => {
    const home = await machine();

    const answer = await homeAnswer(
      home,
      { id: 3, method: DAEMON_METHOD.HAND_OVER, action: 'deploy.run' },
      input(home),
    );

    expect(answer.ok).toBe(false);
    expect(answer.reason).toContain('not ready');
  });
});
