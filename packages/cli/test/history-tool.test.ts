import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionHosts, SqliteEventStore, type MemnoxEvent } from '@memnox/core';
import { turnsOf } from '../src/session-tools/history-tool';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-09T18:00:00.000Z');

function row(at: string, over: Partial<MemnoxEvent>): MemnoxEvent {
  return {
    id: `evt_${at}_${over.operation ?? 'w'}`,
    schemaVersion: 1,
    at,
    sessionId: SESSION,
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'filesystem',
    operation: 'filesystem.write',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
    // The fields a test leaves out are optional on a real row, and the surface strings are the ledger's own.
  } as MemnoxEvent;
}

const ROWS: MemnoxEvent[] = [
  row('2026-10-09T09:05:00.000Z', { target: '/r/src/cart.ts' }),
  row('2026-10-09T09:20:00.000Z', {
    surface: 'git',
    operation: 'git.commit',
    class: 'write',
    exitCode: 0,
  }),
  row('2026-10-09T14:02:00.000Z', {
    surface: 'git',
    operation: 'git.push',
    target: 'main',
    effect: 'deny',
  }),
  row('2026-10-09T14:03:00.000Z', {
    surface: 'git',
    operation: 'git.push',
    target: 'fix-cart',
    exitCode: 0,
  }),
];

const LINES = [
  { at: '2026-10-09T09:00:00.000Z', who: 'person' as const, text: 'fix the cart total' },
  { at: '2026-10-09T09:04:00.000Z', who: 'tool' as const, text: 'Edit: cart.ts' },
  { at: '2026-10-09T09:21:00.000Z', who: 'agent' as const, text: 'Fixed and committed.' },
  { at: '2026-10-09T14:00:00.000Z', who: 'person' as const, text: 'push it' },
  { at: '2026-10-09T14:04:00.000Z', who: 'agent' as const, text: 'Pushed to fix-cart.' },
];

describe('a whole session, turn by turn', () => {
  it('sets what the ledger saw in the turn it happened in', () => {
    const [first, second] = turnsOf(LINES, ROWS);
    expect(first).toMatchObject({
      asked: 'fix the cart total',
      answered: 'Fixed and committed.',
      tools: 1,
      wrote: ['cart.ts'],
      committed: 1,
      pushed: [],
    });
    expect(second).toMatchObject({
      asked: 'push it',
      answered: 'Pushed to fix-cart.',
      pushed: ['fix-cart'],
      refused: ['git.push main'],
    });
  });

  it('keeps what the agent said along the way, apart from its answer, so the why can be told', () => {
    const [first] = turnsOf(
      [
        LINES[0]!,
        {
          at: '2026-10-09T09:02:00.000Z',
          who: 'agent' as const,
          text: 'The total skips discounts, so I will apply them before tax rather than after.',
        },
        ...LINES.slice(1),
      ],
      ROWS,
    );
    expect(first?.explained).toEqual([
      'The total skips discounts, so I will apply them before tax rather than after.',
    ]);
    expect(first?.answered).toBe('Fixed and committed.');
  });

  it('still tells what it did when no transcript can be read', () => {
    const [only] = turnsOf([], ROWS, 'fix the cart');
    expect(only).toMatchObject({
      asked: 'fix the cart',
      committed: 1,
      pushed: ['fix-cart'],
    });
  });

  it('answers for a session from its start to how it ended, however long ago', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-history-'));
    const store = SqliteEventStore.forHome(home);
    for (const each of ROWS) await store.append(each);
    store.close();
    const project = join(home, '.claude', 'projects', 'shop');
    await mkdir(project, { recursive: true });
    const transcript = [
      {
        type: 'user',
        timestamp: LINES[0]?.at,
        message: { content: 'fix the cart total' },
      },
      {
        type: 'assistant',
        timestamp: LINES[2]?.at,
        message: { content: [{ type: 'text', text: 'Fixed and committed.' }] },
      },
      { type: 'user', timestamp: LINES[3]?.at, message: { content: 'push it' } },
      {
        type: 'assistant',
        timestamp: LINES[4]?.at,
        message: { content: [{ type: 'text', text: 'Pushed to fix-cart.' }] },
      },
    ];
    await writeFile(
      join(project, `${SESSION}.jsonl`),
      transcript.map((each) => JSON.stringify(each)).join('\n'),
    );
    const hosts = new SessionHosts(home);
    await hosts.note({
      sessionId: SESSION,
      agent: 'claude-code',
      pid: 999_999,
      cwd: '/r',
      seenAt: '2026-10-09T08:59:00.000Z',
    });
    await hosts.end(SESSION, '2026-10-09T15:00:00.000Z');
    const deps: SessionToolDeps = {
      home,
      cwd: home,
      agent: 'claude-code',
      env: {},
      // Days later, past the window the sessions list looks back over.
      now: () => new Date(NOW.getTime() + 5 * 24 * 3_600_000),
      readStatus: async () => ({}),
      milestonesAt: async () => [],
      brief: async () => null,
    };
    const history = (await callOperatorTool(deps, {} as RewindSeams, 'history', {
      session: SESSION,
    })) as Record<string, unknown>;
    expect(history).toMatchObject({
      found: true,
      startedAt: '2026-10-09T08:59:00.000Z',
      ended: 'closed',
      endedAt: '2026-10-09T15:00:00.000Z',
      turnCount: 2,
      totals: { commits: 1, pushes: 1, refused: 1 },
    });
  });
});
