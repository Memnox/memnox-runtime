import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileGrants } from '../src/gate/session-grants';
import { Missions } from '../src/session/mission';
import { SessionTurns } from '../src/session/session-turns';
import { exclusively } from '../src/store/exclusive';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memnox-exclusive-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('a store many agents write at once keeps every write', () => {
  it('runs one critical section at a time', async () => {
    let inside = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        exclusively(join(home, 'dir'), async () => {
          inside += 1;
          most = Math.max(most, inside);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inside -= 1;
        }),
      ),
    );
    expect(most).toBe(1);
  });

  it('joins twenty sessions to one mission at once without losing any', async () => {
    const missions = new Missions(home);
    const mission = await missions.start('Overnight swarm', {
      now: '2026-10-08T00:00:00.000Z',
    });
    const sessions = Array.from({ length: 20 }, (_, n) => `ses_${n}`);
    await Promise.all(sessions.map((each) => missions.attach(mission.id, each)));
    expect((await missions.read(mission.id))?.sessions.sort()).toEqual(
      [...sessions].sort(),
    );
  });

  it('spends a single yes once when two seams reach for it together', async () => {
    const grants = new FileGrants(home);
    const subject = { sessionId: 'ses_1', operation: 'git.push', fingerprint: 'f1' };
    await grants.allowOnce(subject, '2026-10-09T00:00:00.000Z');
    const spent = await Promise.all([
      grants.takeOnce(subject, '2026-10-08T00:00:00.000Z'),
      grants.takeOnce(subject, '2026-10-08T00:00:00.000Z'),
    ]);
    expect(spent.filter(Boolean)).toHaveLength(1);
  });

  it('keeps a prompt and an ending written at the same moment', async () => {
    const turns = new SessionTurns(home);
    await turns.prompted('ses_1', 'claude-code', '2026-10-08T00:00:00.000Z');
    await Promise.all([
      turns.ended('ses_1', 'claude-code', '2026-10-08T01:00:00.000Z'),
      turns.prompted('ses_2', 'codex', '2026-10-08T01:00:00.000Z'),
    ]);
    expect((await turns.read('ses_1'))?.endedAt).toBe('2026-10-08T01:00:00.000Z');
    expect((await turns.read('ses_2'))?.promptAt).toBe('2026-10-08T01:00:00.000Z');
  });
});
