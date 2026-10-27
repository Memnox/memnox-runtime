import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeHold,
  HOLD_ANSWER,
  HOLD_OUTCOME,
  HoldService,
  type HoldRequest,
} from '../src/gate/hold';
import { PendingApprovals } from '../src/gate/pending';
import { RoutedHoldPrompt } from '../src/gate/routed-prompt';
import { FileGrants } from '../src/gate/session-grants';

const PARK_MS = 16 * 60 * 60 * 1000;

let home: string;
let clock: number;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memnox-parked-'));
  clock = Date.parse('2026-10-07T22:00:00.000Z');
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const request: HoldRequest = {
  sessionId: 'ses_night',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'origin main',
  fingerprint: 'f00dfeed00000000',
  reason: 'pushing asks',
};

function service(): HoldService {
  const prompt = new RoutedHoldPrompt({
    approvals: new PendingApprovals(home),
    now: () => clock,
    // Time passes only when the waiting side sleeps, so a ten minute wait is instant here.
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 60_000,
    parkMs: PARK_MS,
  });
  return new HoldService(prompt, 10 * 60 * 1000, new FileGrants(home));
}

describe('a question nobody is there to answer is kept, and the agent carries on', () => {
  it('parks it rather than dropping it, and tells the agent to carry on', async () => {
    const result = await service().hold(request);
    expect(result.outcome).toBe(HOLD_OUTCOME.PARKED);
    const pending = await new PendingApprovals(home).list(new Date(clock).toISOString());
    expect(pending).toHaveLength(1);
    expect(pending[0]?.parkedAt).toBeDefined();
    const told = describeHold(result, request);
    expect(told).toContain(`parked as ${pending[0]?.id}`);
    expect(told).toContain('Carry on with the parts of the task that do not need it');
  });

  it('answers a retry at once while it still waits, without asking twice', async () => {
    await service().hold(request);
    const before = clock;
    const again = await service().hold(request);
    expect(again.outcome).toBe(HOLD_OUTCOME.PARKED);
    expect(clock).toBe(before);
    expect(
      await new PendingApprovals(home).list(new Date(clock).toISOString()),
    ).toHaveLength(1);
  });

  it('lets the retry through once a person says yes from wherever they are', async () => {
    const first = await service().hold(request);
    clock += 3 * 60 * 60 * 1000;
    await new PendingApprovals(home).answer(
      first.approvalId ?? '',
      HOLD_ANSWER.ONCE,
      'the phone',
      new Date(clock).toISOString(),
    );
    const retry = await service().hold(request);
    expect(retry.outcome).toBe(HOLD_OUTCOME.ALLOWED);
    expect(retry.by).toBe('the phone');
    expect(
      await new PendingApprovals(home).list(new Date(clock).toISOString()),
    ).toHaveLength(0);
  });

  it('refuses the retry when the person said no', async () => {
    const first = await service().hold(request);
    await new PendingApprovals(home).answer(
      first.approvalId ?? '',
      HOLD_ANSWER.DENY,
      'the phone',
      new Date(clock).toISOString(),
    );
    const retry = await service().hold(request);
    expect(retry.outcome).toBe(HOLD_OUTCOME.DENIED);
  });

  it('stops being answerable once the person has been away past the parking time', async () => {
    await service().hold(request);
    clock += PARK_MS + 60_000;
    const moment = new Date(clock).toISOString();
    expect(await new PendingApprovals(home).list(moment)).toHaveLength(0);
    expect(await new PendingApprovals(home).parkedFor(request, moment)).toBeNull();
  });
});
