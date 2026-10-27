import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemnoxEvent } from '../src/event/event';
import {
  describeMission,
  describeStandings,
  isMissionId,
  Missions,
  SESSION_STANDING,
  summarizeMission,
  withWorkersOf,
  type Mission,
} from '../src/session/mission';

const NOW = '2026-10-07T09:00:00.000Z';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memnox-mission-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('a mission joins sessions under one goal', () => {
  it('starts, joins sessions once each in order, and finds a session by its mission', async () => {
    const missions = new Missions(home);
    const mission = await missions.start('Fix payment webhook failures', {
      reference: 'INC-421',
      now: NOW,
    });
    expect(isMissionId(mission.id)).toBe(true);
    await missions.attach(mission.id, 'ses_a');
    await missions.attach(mission.id, 'ses_b');
    await missions.attach(mission.id, 'ses_a');
    expect((await missions.read(mission.id))?.sessions).toEqual(['ses_a', 'ses_b']);
    expect((await missions.ofSession('ses_b'))?.id).toBe(mission.id);
    expect(await missions.ofSession('ses_z')).toBeNull();
  });

  it('refuses a session for a closed mission', async () => {
    const missions = new Missions(home);
    const mission = await missions.start('Ship the dashboard', { now: NOW });
    await missions.close(mission.id, NOW);
    await expect(missions.attach(mission.id, 'ses_a')).rejects.toThrow(/closed/);
  });

  it('never reads an id that could be a path', async () => {
    expect(isMissionId('../../etc/passwd')).toBe(false);
    expect(await new Missions(home).read('../x')).toBeNull();
  });
});

function event(
  sessionId: string,
  minute: number,
  over: Partial<MemnoxEvent> = {},
): MemnoxEvent {
  return {
    id: `${sessionId}_${minute}`,
    schemaVersion: 1,
    at: `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`,
    sessionId,
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'npm.test',
    class: 'read',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

describe('one lost session does not lose the mission', () => {
  const mission: Mission = {
    id: 'msn_0000abcd',
    statement: 'Twelve tasks overnight',
    startedAt: NOW,
    sessions: [
      'ses_ok',
      'ses_recovered',
      'ses_failing',
      'ses_waiting',
      'ses_stopped',
      'ses_new',
    ],
  };
  const events = [
    event('ses_ok', 1, { exitCode: 0 }),
    event('ses_recovered', 2, { exitCode: 1 }),
    event('ses_recovered', 3, { exitCode: 0 }),
    event('ses_failing', 4, { exitCode: 1 }),
    event('ses_waiting', 5, { exitCode: 0 }),
    event('ses_stopped', 6, { exitCode: 1 }),
    event('ses_other', 7, { exitCode: 1 }),
  ];

  it('gives each session its own standing', () => {
    const summary = summarizeMission(mission, events, {
      waiting: new Set(['ses_waiting']),
      stopped: new Set(['ses_stopped']),
    });
    expect(summary.standings.map((each) => each.standing)).toEqual([
      SESSION_STANDING.CLEAR,
      SESSION_STANDING.CLEAR,
      SESSION_STANDING.FAILING,
      SESSION_STANDING.WAITING,
      SESSION_STANDING.STOPPED,
      SESSION_STANDING.NOT_STARTED,
    ]);
    expect(describeStandings(summary)).toBe(
      '2 clear, 1 waiting, 1 failing, 1 stopped, 1 not started',
    );
  });

  it('adds up only its own sessions', () => {
    const summary = summarizeMission(mission, events);
    expect(summary.actions).toBe(6);
    expect(summary.recovered).toBe(1);
    expect(summary.firstAt).toBe('2026-10-07T10:01:00.000Z');
    expect(describeMission(summary)[2]).toBe('  worked 5m, 6 action(s)');
  });
});

describe("an orchestrator's workers join by where they work", () => {
  const mission: Mission = {
    id: 'msn_0000beef',
    statement: 'Twelve tasks overnight',
    startedAt: '2026-10-07T22:00:00.000Z',
    sessions: ['ses_lead'],
    root: '/work/shop',
  };
  const roots = ['/work/shop', '/work/shop-worktrees/builder'];

  it('adds sessions in the repository and its worktrees while the mission is open', () => {
    const joined = withWorkersOf(
      mission,
      [
        { sessionId: 'ses_lead', cwd: '/work/shop', seenAt: '2026-10-07T22:00:01.000Z' },
        {
          sessionId: 'ses_research',
          cwd: '/work/shop/docs',
          seenAt: '2026-10-07T22:05:00.000Z',
        },
        {
          sessionId: 'ses_builder',
          cwd: '/work/shop-worktrees/builder',
          seenAt: '2026-10-07T22:06:00.000Z',
        },
        {
          sessionId: 'ses_before',
          cwd: '/work/shop',
          seenAt: '2026-10-07T21:00:00.000Z',
        },
        {
          sessionId: 'ses_sibling',
          cwd: '/work/shop-legacy',
          seenAt: '2026-10-07T22:07:00.000Z',
        },
        { sessionId: 'ses_nowhere', seenAt: '2026-10-07T22:08:00.000Z' },
      ],
      roots,
    );
    expect(joined.sessions).toEqual(['ses_lead', 'ses_research', 'ses_builder']);
  });

  it('adds nobody after it was closed', () => {
    const joined = withWorkersOf(
      { ...mission, closedAt: '2026-10-08T06:00:00.000Z' },
      [{ sessionId: 'ses_late', cwd: '/work/shop', seenAt: '2026-10-08T07:00:00.000Z' }],
      roots,
    );
    expect(joined.sessions).toEqual(['ses_lead']);
  });
});
