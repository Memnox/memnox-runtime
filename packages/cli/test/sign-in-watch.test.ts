import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTICE_KIND,
  Proposals,
  WORK_ACCOUNT_CHECK,
  type WorkAccountCheck,
} from '@memnox/core';
import { SignInWatcher } from '../src/daemon/sign-in-watch';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import type { CheckedAccount, PersonalAnswer } from '../src/sync/personal-work';
import { PendingSignIns } from '../src/sync/sign-ins';

const ASKED_AT = '2026-10-09T09:00:00.000Z';
const SOON = '2026-10-09T09:00:30.000Z';
const LATER = '2026-10-09T09:06:00.000Z';
const SAID = 'email Sara a summary of this week';

async function homeWith(toolkit: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-sign-in-'));
  await new PendingSignIns(home).offer({ toolkit, said: SAID, at: ASKED_AT });
  return home;
}

function reads(
  accounts: CheckedAccount[],
): () => Promise<PersonalAnswer<CheckedAccount[]>> {
  return async () => ({ ok: true, value: accounts });
}

function gmail(check: WorkAccountCheck): CheckedAccount {
  return {
    toolkit: 'gmail',
    account: { externalId: 'me@home.test', handle: 'me@home.test' },
    check,
  };
}

describe('carrying on once the person signs in', () => {
  it('says nothing while the sign in is still open, and asks the workspace nothing when none is', async () => {
    const home = await homeWith('gmail');
    expect(await new SignInWatcher(home, reads([])).look(SOON)).toEqual([]);
    let asked = 0;
    const idle = await mkdtemp(join(tmpdir(), 'memnox-sign-in-'));
    await new SignInWatcher(idle, async () => {
      asked += 1;
      return { ok: true, value: [] };
    }).look(SOON);
    expect(asked).toBe(0);
  });

  it('tells the Mac whose account it reached and what to carry on with, once', async () => {
    const home = await homeWith('gmail');
    const watcher = new SignInWatcher(home, reads([gmail(WORK_ACCOUNT_CHECK.MATCHED)]));
    const [event] = await watcher.look(SOON);
    expect(event?.notice).toBe(NOTICE_KIND.SIGNED_IN);
    expect(event?.summary).toBe('Signed in to Gmail as me@home.test.');
    expect(event?.signedIn?.resume).toBe(SAID);
    expect(event?.signedIn?.confirm).toBeUndefined();
    expect(await watcher.look(SOON)).toEqual([]);
  });

  it('carries on with an account nothing ties to them yet, naming it rather than asking for Touch ID', async () => {
    const home = await homeWith('gmail');
    const watcher = new SignInWatcher(
      home,
      reads([gmail(WORK_ACCOUNT_CHECK.UNVERIFIED)]),
    );
    const [event] = await watcher.look(SOON);
    expect(event?.signedIn?.resume).toBe(SAID);
    expect(event?.signedIn?.account?.handle).toBe('me@home.test');
    expect(event?.signedIn?.confirm).toBeUndefined();
    expect(await new Proposals(home).open(SOON)).toEqual([]);
    expect(await new WaitingFeed(home).current(SOON)).toEqual([]);
  });

  it('keeps what they first asked when the sign in is offered again mid conversation', async () => {
    const home = await homeWith('slack');
    await new PendingSignIns(home).offer({
      toolkit: 'slack',
      said: 'the icon does not open',
      at: SOON,
    });
    const [kept] = await new PendingSignIns(home).all();
    expect(kept?.said).toBe(SAID);
  });

  it("does not call a sign in to somebody else's account done", async () => {
    const home = await homeWith('gmail');
    const watcher = new SignInWatcher(home, reads([gmail(WORK_ACCOUNT_CHECK.MISMATCH)]));
    expect(await watcher.look(SOON)).toEqual([]);
  });

  it('explains a sign in that never finished, with the company approval it usually is', async () => {
    const home = await homeWith('slack');
    const [event] = await new SignInWatcher(home, reads([])).look(LATER);
    expect(event?.notice).toBe(NOTICE_KIND.SIGN_IN_STALLED);
    expect(event?.summary).toContain('admin to approve Memnox');
    expect(await new PendingSignIns(home).all()).toEqual([]);
  });
});
