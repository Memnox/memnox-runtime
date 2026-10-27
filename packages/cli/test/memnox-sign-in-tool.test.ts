import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORK_ACCOUNT_CHECK, type PersonStanding } from '@memnox/core';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { memnoxSignInTool, myAccountsTool } from '../src/session-tools/account-tools';
import { findToolTool } from '../src/session-tools/personal-tools';
import { PERSONAL_TOOLS } from '../src/session-tools/personal-catalogue';

const NOW = new Date('2026-10-19T12:00:00.000Z');

async function depsWith(
  standing: PersonStanding | null,
  check: (typeof WORK_ACCOUNT_CHECK)[keyof typeof WORK_ACCOUNT_CHECK] = WORK_ACCOUNT_CHECK.MATCHED,
): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-sign-in-'));
  const github = {
    toolkit: 'github',
    account: { externalId: '42', handle: 'maya' },
    check,
  };
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
    memnoxSignIn: async () => standing,
    personalWork: {
      find: async () => ({
        ok: true,
        value: {
          tools: [],
          accounts: [github],
          signInFirst: [],
          signInAgain: [],
          needsAdmin: [],
          unknown: [],
        },
      }),
      run: async () => ({ ok: true, value: { workClass: 'read', data: {} } }),
      link: async (toolkit) => ({ ok: true, value: `https://consent/${toolkit}` }),
      accounts: async () => ({ ok: true, value: [github] }),
      connections: async () => ({
        ok: true,
        value: [
          { toolkit: 'github', connected: true },
          { toolkit: 'gmail', connected: true },
          { toolkit: 'linear', connected: true },
          { toolkit: 'notion', connected: false },
          { toolkit: 'slack', connected: true },
        ],
      }),
      signOut: async () => ({ ok: true, value: 1 }),
      signIn: async () => ({ ok: true, value: { url: 'https://consent', opened: true } }),
    },
  };
}

describe('signing the person in to Memnox by voice', () => {
  it('is a tool the voice has, so it never sends them to a menu or a terminal', () => {
    const tool = PERSONAL_TOOLS.find((each) => each.name === 'memnox_sign_in');
    expect(tool?.description).toContain('Memnox Cloud');
  });

  it('starts the daemon sign in and says the code to approve', async () => {
    const said = (await memnoxSignIn({
      signedIn: false,
      code: { userCode: 'ABCD-1234', expiresAt: NOW.getTime() + 600_000 },
    })) as { started: boolean; code: string; said: string };
    expect(said.started).toBe(true);
    expect(said.code).toBe('ABCD-1234');
    expect(said.said).toContain('ABCD-1234');
  });

  it('says they are already signed in rather than starting again', async () => {
    const said = (await memnoxSignIn({ signedIn: true, name: 'Maya' })) as {
      done: boolean;
      said: string;
    };
    expect(said.done).toBe(true);
    expect(said.said).toContain('as Maya');
  });

  it('says the daemon did not answer, never that it worked', async () => {
    const said = (await memnoxSignIn(null)) as { done: boolean; said: string };
    expect(said.done).toBe(false);
    expect(said.said).toContain('did not answer');
  });

  it('says why a sign in that never started stopped', async () => {
    const said = (await memnoxSignIn({ signedIn: false, failed: 'expired' })) as {
      said: string;
    };
    expect(said.said).toContain('expired');
  });
});

describe('the tools the person is connected to', () => {
  it('counts what the Tools panel shows, connected ones only', async () => {
    const answer = (await myAccountsTool(await depsWith(null))) as {
      connected: string[];
    };
    expect(answer.connected).toEqual(['github', 'gmail', 'linear', 'slack']);
  });

  it('never lets find_tool call an unverified account one still to confirm', async () => {
    const deps = await depsWith(null, WORK_ACCOUNT_CHECK.UNVERIFIED);
    const found = (await findToolTool(deps, { what: 'comment' })) as {
      accountsSaid?: string;
    };
    expect(found.accountsSaid).toContain('Never say it needs confirming');
  });

  it('adds nothing about confirming when every account is matched', async () => {
    const found = (await findToolTool(await depsWith(null), { what: 'comment' })) as {
      accountsSaid?: string;
    };
    expect(found.accountsSaid).toBeUndefined();
  });
});

async function memnoxSignIn(standing: PersonStanding | null): Promise<unknown> {
  return memnoxSignInTool(await depsWith(standing));
}
