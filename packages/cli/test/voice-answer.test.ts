import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  FileGrants,
  HOLD_ANSWER,
  HOLD_OUTCOME,
  holdGrantSubject,
  HoldService,
  PendingApprovals,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  RoutedHoldPrompt,
  type HoldRequest,
  type HoldResult,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { withEvents } from '../src/event-store';

/**
 * The voice is one more route to the same held call, beside the terminal, `memnox approve`
 * and the workspace DM. Whichever answers first releases the agent, and the rest are told.
 */

const HELD: HoldRequest = {
  sessionId: 'ses_voice',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

/** A delete inside the repository the session works in, which a tap may allow. */
const INSIDE: HoldRequest = {
  sessionId: 'ses_voice',
  agent: 'claude-code',
  operation: 'filesystem.delete',
  target: '/work/shop/old.ts',
  fingerprint: 'def456abc123',
  reason: 'a delete asks first',
  withinSession: true,
};

const TEN_SECONDS = 10_000;

interface Held {
  home: string;
  /** What the agent's session gets back once somebody answers. */
  result: Promise<HoldResult>;
  id: string;
  signs: (subject: string, answer: string) => string;
}

/** An agent's call held exactly as a shell seam holds one, with no terminal to ask at. */
async function held(request: HoldRequest = HELD): Promise<Held> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-answer-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    new Date().toISOString(),
  );
  const approvals = new PendingApprovals(home);
  const service = new HoldService(
    new RoutedHoldPrompt({ approvals, pollMs: 10 }),
    TEN_SECONDS,
    new FileGrants(home),
  );
  const result = service.hold(request);
  const id = await raised(approvals);
  return {
    home,
    result,
    id,
    signs: (subject, answer) =>
      sign(
        'sha256',
        Buffer.from(confirmationMessage(subject, answer)),
        privateKey,
      ).toString('base64'),
  };
}

async function raised(approvals: PendingApprovals): Promise<string> {
  for (let tries = 0; tries < 200; tries += 1) {
    const [first] = await approvals.list(new Date().toISOString());
    if (first !== undefined) return first.id;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the call was never held');
}

function now(): string {
  return new Date().toISOString();
}

describe('answering a held call by voice', () => {
  it('lets the agent carry on after a signed "allow once"', async () => {
    const call = await held();
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      signature: call.signs(call.id, HOLD_ANSWER.ONCE),
      at: now(),
    });

    expect(said).toEqual({ ok: true, outcome: HOLD_ANSWER.ONCE });
    expect(await call.result).toMatchObject({
      outcome: HOLD_OUTCOME.ALLOWED,
      answer: HOLD_ANSWER.ONCE,
    });
  });

  it('lets it carry on for the rest of the session, so the next identical call is not asked', async () => {
    const call = await held();
    await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.SESSION,
      signature: call.signs(call.id, HOLD_ANSWER.SESSION),
      at: now(),
    });

    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
    expect(await new FileGrants(call.home).covers(holdGrantSubject(HELD))).toBe(true);
  });

  it('hands the agent a refusal on a spoken "deny", which needs no Touch ID', async () => {
    const call = await held();
    await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.DENY,
      at: now(),
    });

    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.DENIED });
  });

  it('keeps the agent waiting on a spoken "allow" that carries no signature', async () => {
    const call = await held();
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      at: now(),
    });
    expect(said.ok).toBe(false);

    // Still answerable from the terminal or a DM, which is who settles it here.
    await new PendingApprovals(call.home).answer(
      call.id,
      HOLD_ANSWER.DENY,
      'the workspace',
      now(),
    );
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.DENIED });
  });

  it('lets a call that stays in its repository through on a yes with no Touch ID', async () => {
    const call = await held(INSIDE);
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      at: now(),
    });

    expect(said).toEqual({ ok: true, outcome: HOLD_ANSWER.ONCE });
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
    const rows = await withEvents(call.home, (store) =>
      store.query({ sessionId: INSIDE.sessionId, limit: 10 }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        actorType: 'human',
        effect: 'allow',
        authorizedBy: 'person (inside the session)',
      }),
    );
  });

  it('confirms a spoken yes to a call that stays in its repository with no Touch ID', async () => {
    const call = await held(INSIDE);
    const proposal = await new Proposals(call.home).propose({
      change: {
        kind: PROPOSAL_KIND.ANSWER,
        pendingId: call.id,
        answer: HOLD_ANSWER.ONCE,
      },
      rationale: 'yes, delete it',
      proposedBy: 'agt_memnox-operator',
      at: now(),
      ttlMs: TEN_SECONDS,
    });
    const said = await confirmAnswer(call.home, {
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      at: now(),
    });

    expect(said.ok).toBe(true);
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
  });

  it('still wants Touch ID for a spoken yes to a call that reaches outside', async () => {
    const call = await held();
    const proposal = await new Proposals(call.home).propose({
      change: {
        kind: PROPOSAL_KIND.ANSWER,
        pendingId: call.id,
        answer: HOLD_ANSWER.ONCE,
      },
      rationale: 'yes, push it',
      proposedBy: 'agt_memnox-operator',
      at: now(),
      ttlMs: TEN_SECONDS,
    });
    const said = await confirmAnswer(call.home, {
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      at: now(),
    });

    expect(said.ok).toBe(false);
    await new PendingApprovals(call.home).answer(
      call.id,
      HOLD_ANSWER.DENY,
      'the workspace',
      now(),
    );
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.DENIED });
  });

  it('leaves the DM and the terminal working, and tells the voice who answered first', async () => {
    const call = await held();
    await new PendingApprovals(call.home).answer(
      call.id,
      HOLD_ANSWER.ONCE,
      'the workspace',
      now(),
    );

    const late = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.DENY,
      at: now(),
    });

    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
    // Answered already, or cleared by the released seam: either way the voice changed nothing.
    expect(late.ok ? late.outcome : late.error).toMatch(
      /already answered|no longer held/,
    );
  });

  it('writes the answer into the agent session, naming the person', async () => {
    const call = await held();
    await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      signature: call.signs(call.id, HOLD_ANSWER.ONCE),
      at: now(),
    });
    await call.result;
    const rows = await withEvents(call.home, (store) =>
      store.query({ sessionId: HELD.sessionId, limit: 10 }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        actorType: 'human',
        operation: 'git.push',
        effect: 'allow',
        authorizedBy: 'person (Touch ID)',
      }),
    );
  });

  it('keeps what the person said when an allow came through a proposal', async () => {
    const call = await held();
    const proposal = await new Proposals(call.home).propose({
      change: {
        kind: PROPOSAL_KIND.ANSWER,
        pendingId: call.id,
        answer: HOLD_ANSWER.ONCE,
      },
      rationale: 'yeah push it, just this once',
      said: 'yeah push it, just this once',
      proposedBy: 'agt_memnox-operator',
      at: now(),
      ttlMs: TEN_SECONDS,
    });
    await confirmAnswer(call.home, {
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: call.signs(proposal.id, PROPOSAL_ANSWER.CONFIRMED),
      at: now(),
    });
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
    const rows = await withEvents(call.home, (store) =>
      store.query({ sessionId: HELD.sessionId, limit: 10 }),
    );
    expect(rows.find((each) => each.actorType === 'human')?.reason).toContain(
      'saying "yeah push it, just this once"',
    );
  });
});
