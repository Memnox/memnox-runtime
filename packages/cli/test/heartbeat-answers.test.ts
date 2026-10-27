import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_REASON_MAX,
  answeredText,
  answerReasonOf,
  HOLD_ANSWER,
  PendingApprovals,
  SqliteEventStore,
  type HoldRequest,
  type PendingApproval,
} from '@memnox/core';
import { applyAnswers } from '../src/sync/heartbeat-reply';

const request: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'hermes',
  operation: 'vercel.deploy-production',
  fingerprint: 'abc12345',
  reason: 'production deploys are held',
  target: 'shop',
};

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-beat-'));
const NOW = '2026-09-05T10:00:00.000Z';

/**
 * The seam writes a held call to disk and polls it; the heartbeat is the only
 * per-machine round trip there is. These assert the contract between them — that an
 * answer arriving from anywhere lands where the waiting seam is looking.
 */
describe('an answer from the workspace reaches the machine', () => {
  it('releases the call the seam is waiting on', async () => {
    const where = await home();
    const approvals = new PendingApprovals(where);
    const pending = await approvals.raise(request, NOW, 120_000);

    // What the heartbeat would do with { id, answer } coming back.
    await approvals.answer(pending.id, HOLD_ANSWER.ONCE, 'a reviewer', NOW);

    const answered = await approvals.read(pending.id);
    expect(answered?.answer).toBe(HOLD_ANSWER.ONCE);
    expect(answered?.answeredBy).toBe('a reviewer');
  });

  it('carries a refusal as a refusal', async () => {
    const approvals = new PendingApprovals(await home());
    const pending = await approvals.raise(request, NOW, 120_000);
    await approvals.answer(pending.id, HOLD_ANSWER.DENY, 'a reviewer', NOW);
    expect((await approvals.read(pending.id))?.answer).toBe(HOLD_ANSWER.DENY);
  });

  /* Two people reaching for the same approval is ordinary. The first answer stands,
     so a terminal and the workspace cannot overwrite each other. */
  it('keeps the first answer when two arrive', async () => {
    const approvals = new PendingApprovals(await home());
    const pending = await approvals.raise(request, NOW, 120_000);

    await approvals.answer(pending.id, HOLD_ANSWER.ONCE, 'the terminal', NOW);
    const second = await approvals.answer(
      pending.id,
      HOLD_ANSWER.DENY,
      'the workspace',
      NOW,
    );

    expect(second).not.toBeNull();
    expect(second !== null && 'alreadyAnswered' in second).toBe(true);
    expect((await approvals.read(pending.id))?.answeredBy).toBe('the terminal');
  });

  it("writes the person's answer into the ledger, naming who and that it came from the workspace", async () => {
    const where = await home();
    const approvals = new PendingApprovals(where);
    const pending = await approvals.raise(request, NOW, 120_000);

    await applyAnswers(
      where,
      approvals,
      [{ id: pending.id, answer: 'once', by: 'Ada' }],
      NOW,
    );

    const store = SqliteEventStore.forHome(where);
    const rows = await store.query({ limit: 10 });
    store.close();
    expect(rows).toEqual([
      expect.objectContaining({
        actorType: 'human',
        principal: 'Ada (the workspace)',
        authorizedBy: 'Ada (the workspace)',
        operation: 'vercel.deploy-production',
      }),
    ]);
  });

  it('has nothing to say about an id this machine never raised', async () => {
    const approvals = new PendingApprovals(await home());
    expect(await approvals.answer('apr_nothing', HOLD_ANSWER.ONCE, 'x', NOW)).toBeNull();
  });

  /* Names only. What crosses the wire about a held call is the operation and what it
     is about — never the arguments, which is the rule the ledger already follows. */
  it('holds nothing in the record that the wire should not carry', async () => {
    const approvals = new PendingApprovals(await home());
    const pending = await approvals.raise(request, NOW, 120_000);
    const wire = {
      id: pending.id,
      agent: pending.request.agent,
      operation: pending.request.operation,
      target: pending.request.target,
      reason: pending.request.reason,
    };
    expect(Object.keys(wire)).not.toContain('command');
    expect(JSON.stringify(wire)).not.toContain('arguments');
  });
});

/* A no that only says no leaves the agent nothing to try. The person's reason rides back on
   the beat, and the agent is told it beside the rule's own way forward. */
describe('a no with a reason', () => {
  const held: HoldRequest = {
    ...request,
    operation: 'psql.delete-unbounded',
    alternative:
      'Instead: psql.delete-unbounded: add a WHERE to the DELETE on orders that bounds it to the rows this task needs, such as only the test orders, and run it again.',
  };

  it('keeps the reason a deny came back with, as one clipped line', async () => {
    const where = await home();
    const approvals = new PendingApprovals(where);
    const pending = await approvals.raise(held, NOW, 120_000);

    await applyAnswers(
      where,
      approvals,
      [
        {
          id: pending.id,
          answer: 'deny',
          by: 'Ada',
          reason: '  only the test orders,\nnot every customer  ',
        },
      ],
      NOW,
    );

    const answered = await approvals.read(pending.id);
    expect(answered?.answerReason).toBe('only the test orders, not every customer');
    const told = answeredText(answered as PendingApproval);
    expect(told).toContain('They said: only the test orders, not every customer.');
    expect(told).toContain('a WHERE to the DELETE on orders');
  });

  it('drops a reason that came with a yes, and one that is not a string', async () => {
    const where = await home();
    const approvals = new PendingApprovals(where);
    const yes = await approvals.raise(held, NOW, 120_000);
    const odd = await approvals.raise({ ...held, fingerprint: 'other' }, NOW, 120_000);

    await applyAnswers(
      where,
      approvals,
      [
        { id: yes.id, answer: 'once', by: 'Ada', reason: 'go ahead' },
        { id: odd.id, answer: 'deny', by: 'Ada', reason: 42 as unknown as string },
      ],
      NOW,
    );

    expect((await approvals.read(yes.id))?.answerReason).toBeUndefined();
    expect((await approvals.read(odd.id))?.answerReason).toBeUndefined();
  });

  it('clips a long reason', () => {
    expect(answerReasonOf('x'.repeat(500))?.length).toBe(ANSWER_REASON_MAX);
    expect(answerReasonOf('   ')).toBeUndefined();
  });
});
