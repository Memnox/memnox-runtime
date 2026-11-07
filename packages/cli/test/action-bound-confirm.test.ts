import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actionConfirmationMessage,
  actionDigestOf,
  confirmationMessage,
  ConfirmKeys,
  DAEMON_EVENT,
  HOLD_ANSWER,
  PendingApprovals,
  pendingDirFor,
  type HoldRequest,
  type PendingApproval,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { WaitingFeed } from '../src/daemon/waiting-feed';

/**
 * A yes to a held call is bound to the call the person saw: the daemon works its digest out again
 * from the call it holds, so a call rewritten after it was shown is refused, and v1 still answers.
 */

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T12:00:30.000Z';
const TWO_MINUTES = 120_000;

const PUSH: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'origin/main',
  command: 'git push origin main',
  cwd: '/Users/bo/acme',
  fingerprint: 'fp_push',
  reason: 'pushing to main needs a person',
};

async function fixture(): Promise<{
  home: string;
  held: PendingApproval;
  signs: (message: string) => string;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-action-bound-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW,
  );
  const held = await new PendingApprovals(home).raise(PUSH, NOW, TWO_MINUTES);
  return { home, held, signs: (message) => signed(message, privateKey) };
}

function signed(message: string, key: KeyObject): string {
  return sign('sha256', Buffer.from(message), key).toString('base64');
}

/** The call on disk rewritten, as anything running as the same user could rewrite it. */
async function rewritten(home: string, id: string, command: string): Promise<void> {
  const path = join(pendingDirFor(home), `${id}.json`);
  const record = JSON.parse(await readFile(path, 'utf8')) as PendingApproval;
  await writeFile(
    path,
    JSON.stringify({ ...record, request: { ...record.request, command } }),
  );
}

describe('a yes bound to the exact call', () => {
  it('signs the call itself as v4, the digest written out from five fields', () => {
    const digest = actionDigestOf(PUSH);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(actionConfirmationMessage('apr_1', HOLD_ANSWER.ONCE, digest)).toBe(
      `memnox-confirm:v4:apr_1:once:${digest}`,
    );
    expect(actionDigestOf({ ...PUSH, cwd: '/Users/bo/other' })).not.toBe(digest);
    expect(actionDigestOf({ ...PUSH, command: 'git push -f origin main' })).not.toBe(
      digest,
    );
    // The reason is the rule's words about the call, never the call, so it does not move it.
    const reworded: HoldRequest = { ...PUSH, reason: 'other words' };
    expect(actionDigestOf(reworded)).toBe(digest);
  });

  it('puts the digest on the held event and the waiting list, so a screen can sign v4', async () => {
    const { home, held } = await fixture();
    const feed = new WaitingFeed(home);
    const event = await feed.held(held.id, LATER);
    expect(event).toMatchObject({
      kind: DAEMON_EVENT.HELD,
      actionDigest: actionDigestOf(PUSH),
    });
    const waiting = await feed.current(LATER);
    expect(waiting.find((each) => each.subject === held.id)?.actionDigest).toBe(
      actionDigestOf(PUSH),
    );
  });

  it('lets the call through on a v4 signature over the call as it still is', async () => {
    const { home, held, signs } = await fixture();
    const digest = actionDigestOf(PUSH);
    const result = await confirmAnswer(home, {
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
      signature: signs(actionConfirmationMessage(held.id, HOLD_ANSWER.ONCE, digest)),
      actionDigest: digest,
      at: LATER,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a v4 signature once the call was changed after it was shown', async () => {
    const { home, held, signs } = await fixture();
    const digest = actionDigestOf(PUSH);
    await rewritten(home, held.id, 'git push --force origin main');
    const signature = signs(actionConfirmationMessage(held.id, HOLD_ANSWER.ONCE, digest));

    const named = await confirmAnswer(home, {
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
      signature,
      actionDigest: digest,
      at: LATER,
    });
    expect(named).toMatchObject({ ok: false, refused: true });
    expect('error' in named ? named.error : '').toContain('changed after it was shown');

    // Without saying which digest it signed, the signature still covers nothing held now.
    const unnamed = await confirmAnswer(home, {
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
      signature,
      at: LATER,
    });
    expect(unnamed).toMatchObject({ ok: false, refused: true });
    expect((await new PendingApprovals(home).read(held.id))?.answer).toBeUndefined();
  });

  it('still takes a v1 signature while the screens move to v4', async () => {
    const { home, held, signs } = await fixture();
    const result = await confirmAnswer(home, {
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
      signature: signs(confirmationMessage(held.id, HOLD_ANSWER.ONCE)),
      at: LATER,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('takes a no unsigned whatever the digest says, since refusing never widens', async () => {
    const { home, held } = await fixture();
    const result = await confirmAnswer(home, {
      subject: held.id,
      answer: HOLD_ANSWER.DENY,
      actionDigest: 'stale',
      at: LATER,
    });
    expect(result).toMatchObject({ ok: true });
  });
});
