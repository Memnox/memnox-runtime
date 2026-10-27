import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  isP256Point,
  verifiesConfirmation,
} from '../src/gate/confirm-key';
import { HOLD_ANSWER } from '../src/gate/hold';
import {
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  type ProposedChange,
} from '../src/gate/proposals';

const NOW = '2026-09-30T10:00:00.000Z';
const LATER = '2026-09-30T10:10:00.000Z';
const FIVE_MINUTES = 300_000;

const CHANGE: ProposedChange = {
  kind: PROPOSAL_KIND.ANSWER,
  pendingId: 'apr_x_12345678',
  answer: HOLD_ANSWER.ONCE,
};

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-proposals-'));

async function proposed(proposals: Proposals): Promise<string> {
  const proposal = await proposals.propose({
    change: CHANGE,
    rationale: 'let Claude push this branch once',
    proposedBy: 'agt_memnox-operator',
    at: NOW,
    ttlMs: FIVE_MINUTES,
  });
  return proposal.id;
}

/** A key shaped the way the Secure Enclave hands one over: the raw point, and DER signatures. */
function enclaveLikeKey(): { point: string; signs: (message: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    point: spki.subarray(spki.length - 65).toString('base64'),
    signs: (message) =>
      sign('sha256', Buffer.from(message), privateKey).toString('base64'),
  };
}

describe('a proposal', () => {
  it('is written down and listed while it can still be answered', async () => {
    const proposals = new Proposals(await home());
    const id = await proposed(proposals);

    expect(id).toMatch(/^prp_/);
    expect((await proposals.open(NOW)).map((each) => each.id)).toEqual([id]);
    expect(await proposals.open(LATER)).toEqual([]);
  });

  it('lets the first answer win', async () => {
    const proposals = new Proposals(await home());
    const id = await proposed(proposals);

    await proposals.answer(id, PROPOSAL_ANSWER.DECLINED, 'person (voice)', NOW);
    const second = await proposals.answer(id, PROPOSAL_ANSWER.CONFIRMED, 'someone', NOW);

    expect(second).toHaveProperty('alreadyAnswered');
    expect(await proposals.open(NOW)).toEqual([]);
  });

  it('is never confirmed once expired, because the person heard an old one', async () => {
    const proposals = new Proposals(await home());
    const id = await proposed(proposals);

    const outcome = await proposals.answer(id, PROPOSAL_ANSWER.CONFIRMED, 'x', LATER);
    expect(outcome).toHaveProperty('expired');
  });

  it('is null when nothing was proposed under that id', async () => {
    const proposals = new Proposals(await home());
    expect(
      await proposals.answer('prp_nope', PROPOSAL_ANSWER.CONFIRMED, 'x', NOW),
    ).toBeNull();
  });
});

describe('a signed confirmation', () => {
  it('verifies against the key that signed it', () => {
    const key = enclaveLikeKey();
    const signature = key.signs(confirmationMessage('prp_1', 'confirmed'));

    expect(isP256Point(key.point)).toBe(true);
    expect(
      verifiesConfirmation(
        { point: key.point, registeredAt: NOW },
        'prp_1',
        'confirmed',
        signature,
      ),
    ).toBe(true);
  });

  it('confirms nothing but the subject and answer it was made for', () => {
    const key = enclaveLikeKey();
    const registered = { point: key.point, registeredAt: NOW };
    const signature = key.signs(confirmationMessage('prp_1', 'confirmed'));

    expect(verifiesConfirmation(registered, 'prp_2', 'confirmed', signature)).toBe(false);
    expect(verifiesConfirmation(registered, 'prp_1', 'declined', signature)).toBe(false);
  });

  it('refuses a signature from any other key', () => {
    const mine = enclaveLikeKey();
    const theirs = enclaveLikeKey();
    const signature = theirs.signs(confirmationMessage('prp_1', 'confirmed'));

    expect(
      verifiesConfirmation(
        { point: mine.point, registeredAt: NOW },
        'prp_1',
        'confirmed',
        signature,
      ),
    ).toBe(false);
  });

  it('is false rather than a throw for garbage', () => {
    expect(
      verifiesConfirmation({ point: 'nope', registeredAt: NOW }, 'a', 'b', 'c'),
    ).toBe(false);
    const key = enclaveLikeKey();
    expect(
      verifiesConfirmation({ point: key.point, registeredAt: NOW }, 'a', 'b', '!!'),
    ).toBe(false);
  });

  it('trusts the first key and never replaces it', async () => {
    const keys = new ConfirmKeys(await home());
    const first = enclaveLikeKey();
    const second = enclaveLikeKey();

    expect(await keys.register(first.point, NOW)).toHaveProperty('registered');
    expect(await keys.register(second.point, NOW)).toHaveProperty('alreadyRegistered');
    expect((await keys.read())?.point).toBe(first.point);

    await keys.forget();
    expect(await keys.read()).toBeNull();
  });
});
