import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionHosts } from '@memnox/core';
import { awaitSessionStart } from '../src/session-tools/await-start';

const REPOSITORY = '/Users/me/work/memnox-runtime';
const SINCE = '2026-10-09T10:00:00.000Z';

describe('waiting for a started agent to show itself', () => {
  it('sees a session that began in the repository, or a folder in it, after the start', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-await-start-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_new',
      agent: 'claude-code',
      pid: 1,
      cwd: `${REPOSITORY}/packages/cli`,
      seenAt: '2026-10-09T10:00:03.000Z',
    });
    expect(await awaitSessionStart(home, REPOSITORY, SINCE, 50)).toBe('ses_new');
  });

  it('never takes one that was already running, or one in a folder beside it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-await-start-'));
    const hosts = new SessionHosts(home);
    await hosts.note({
      sessionId: 'ses_old',
      agent: 'claude-code',
      pid: 1,
      cwd: REPOSITORY,
      seenAt: '2026-10-09T09:00:00.000Z',
    });
    await hosts.note({
      sessionId: 'ses_beside',
      agent: 'claude-code',
      pid: 2,
      cwd: `${REPOSITORY}-legacy`,
      seenAt: '2026-10-09T10:00:03.000Z',
    });
    expect(await awaitSessionStart(home, REPOSITORY, SINCE, 50)).toBeNull();
  });
});
