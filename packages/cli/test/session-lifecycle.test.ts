import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionHosts, SessionTurns } from '@memnox/core';
import { SessionLives } from '../src/daemon/session-lifecycle';

const STARTED = '2026-10-09T10:00:00.000Z';

function host(sessionId: string, pid: number, seenAt: string, agent = 'claude-code') {
  return { sessionId, agent, pid, cwd: '/Users/me/work/memnox-runtime', seenAt };
}

describe('every session as it begins and ends', () => {
  it('knows the ones already running without announcing them, and announces a new one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-lives-'));
    const hosts = new SessionHosts(home);
    await hosts.note(host('ses_before', 1, '2026-10-09T09:00:00.000Z'));
    const lives = new SessionLives(home, STARTED, { alive: () => true });
    expect(await lives.look('2026-10-09T10:00:10.000Z')).toEqual([]);

    await hosts.note(host('ses_new', 2, '2026-10-09T10:00:15.000Z'));
    await hosts.note(host('ses_brain', 3, '2026-10-09T10:00:15.000Z', 'memnox-operator'));
    const [started, ...rest] = await lives.look('2026-10-09T10:00:20.000Z');
    expect(rest).toEqual([]);
    expect(started).toMatchObject({ notice: 'started', sessionId: 'ses_new' });
    expect(started?.summary).toContain('started a session in memnox-runtime');
    expect(await lives.look('2026-10-09T10:00:30.000Z')).toEqual([]);
  });

  it('says closed when its hook said so, and gone when its process vanished mid turn', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-lives-'));
    const hosts = new SessionHosts(home);
    const alive = new Set([1, 2]);
    const lives = new SessionLives(home, '2026-10-09T09:00:00.000Z', {
      alive: (pid) => alive.has(pid),
    });
    await hosts.note(host('ses_closed', 1, '2026-10-09T09:30:00.000Z'));
    await hosts.note(host('ses_crashed', 2, '2026-10-09T09:30:00.000Z'));
    await new SessionTurns(home).prompted(
      'ses_crashed',
      'claude-code',
      '2026-10-09T09:58:00.000Z',
    );
    expect(await lives.look('2026-10-09T10:00:00.000Z')).toHaveLength(2);

    await hosts.end('ses_closed', '2026-10-09T10:01:00.000Z');
    alive.delete(2);
    const ended = await lives.look('2026-10-09T10:01:10.000Z');
    expect(ended.map((each) => [each.sessionId, each.notice])).toEqual([
      ['ses_closed', 'closed'],
      ['ses_crashed', 'gone'],
    ]);
    expect(ended[1]?.summary).toContain('stopped in the middle of a turn');
  });
});
