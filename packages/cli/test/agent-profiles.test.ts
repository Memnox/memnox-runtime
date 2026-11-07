import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { profilesAnswer } from '../src/daemon/profiles-answer';
import { readProfiles } from '../src/profiles/profile-store';

/**
 * A profile is now the agent's job as well as its bundle: a version 1 file written before the job
 * fields existed still loads, and the job a form sends comes back whole.
 */

const NOW = new Date('2026-11-07T12:00:00.000Z');

async function homeWithV1(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-agent-profiles-'));
  const dir = join(home, '.memnox', 'profiles');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'backend.json'),
    JSON.stringify({
      version: 1,
      id: 'backend',
      name: 'Backend',
      description: 'What a backend change needs',
      skills: ['review'],
      mcpServers: ['linear'],
      updatedAt: '2026-10-01T00:00:00.000Z',
    }),
  );
  return home;
}

function ask(home: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  return profilesAnswer(
    home,
    { id: 1, method: DAEMON_METHOD.PROFILES, ...request } as DaemonRequest,
    NOW,
  );
}

describe('agent profiles kept on this machine', () => {
  it('load a version 1 file unchanged, as version 2 with no job set', async () => {
    const home = await homeWithV1();
    const [profile] = await readProfiles(home);
    expect(profile).toEqual({
      version: 2,
      id: 'backend',
      name: 'Backend',
      description: 'What a backend change needs',
      responsibilities: [],
      owners: [],
      projects: [],
      skills: ['review'],
      mcpServers: ['linear'],
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('keep the job a form sends and show it back', async () => {
    const home = await homeWithV1();
    const put = await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: {
        name: 'Reviewer',
        purpose: 'Reviews every change before it is pushed',
        role: 'reviewer',
        responsibilities: ['read the diff', 'say what is risky'],
        instructions: 'Never push.',
        owners: ['ana'],
        projects: ['prj_0123456789ab'],
        templateOf: 'code-review',
      },
    });
    expect(put.ok).toBe(true);
    const reviewer = (put.profiles ?? []).find((each) => each.id === 'reviewer');
    expect(reviewer).toMatchObject({
      purpose: 'Reviews every change before it is pushed',
      role: 'reviewer',
      responsibilities: ['read the diff', 'say what is risky'],
      instructions: 'Never push.',
      owners: ['ana'],
      projects: ['prj_0123456789ab'],
      templateOf: 'code-review',
    });
  });

  it('refuses a role a rule could never match', async () => {
    const home = await homeWithV1();
    const put = await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Reviewer', role: 'code reviewer' },
    });
    expect(put.ok).toBe(false);
    expect(put.error).toContain('"role" is one word');
  });
});
