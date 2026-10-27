import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answeredText,
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  DEVICE_KIND,
  HOLD_ANSWER,
  loadPoliciesFromFile,
  PendingApprovals,
  PHONE_DEFAULT_CAPABILITIES,
  PolicyEngine,
  Proposals,
  RULE_SCOPE,
  type DeviceRecord,
  type HoldRequest,
} from '@memnox/core';

import { confirmAnswer } from '../src/daemon/confirm';
import { answerWaiting } from '../src/daemon/confirm-question';
import { NEVER_FROM_NOW_ON } from '../src/daemon/from-now-on';
import { machinePolicyPath } from '../src/protect/machine-rules';
import { personKey } from './phone-harness';

/**
 * A no from a phone paired straight to the Mac carries the person's reason into the held call, so the agent
 * hears why, and "deny from now on" keeps that reason on the rule it puts up for the next identical call.
 */

const NOW = '2026-10-23T09:00:00.000Z';
const HELD: HoldRequest = {
  sessionId: 'ses_relay',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'fedcba9876543210',
  reason: 'pushing to main needs a person',
};

async function phoneAndCall(): Promise<{
  home: string;
  id: string;
  device: DeviceRecord;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-relay-deny-'));
  const device: DeviceRecord = {
    id: 'dev_phone',
    name: 'Pixel',
    kind: DEVICE_KIND.PHONE,
    signingPoint: personKey().point,
    noiseStatic: Buffer.alloc(32, 3).toString('base64'),
    capabilities: [...PHONE_DEFAULT_CAPABILITIES],
    pairedAt: NOW,
  };
  const held = await new PendingApprovals(home).raise(HELD, NOW, 120_000);
  return { home, id: held.id, device };
}

describe('a deny with a reason over the relay', () => {
  it('keeps the reason, one clipped line, on the held call the agent reads', async () => {
    const { home, id, device } = await phoneAndCall();
    const said = await answerWaiting(
      home,
      {
        id: 1,
        method: DAEMON_METHOD.CONFIRM,
        subject: id,
        answer: HOLD_ANSWER.DENY,
        reason: '  open a pull request\nagainst a branch instead ',
      },
      NOW,
      { device, driving: false },
    );

    expect(said).toEqual({ ok: true, outcome: HOLD_ANSWER.DENY });
    const answered = await new PendingApprovals(home).read(id);
    expect(answered?.answer).toBe(HOLD_ANSWER.DENY);
    expect(answered?.answerReason).toBe('open a pull request against a branch instead');
    expect(answered?.answeredBy).toBe('person (Pixel)');
    if (answered === null) throw new Error('no held call');
    expect(answeredText(answered)).toContain(
      'They said: open a pull request against a branch instead.',
    );
  });

  it('drops a reason sent with a yes', async () => {
    const { home, id } = await phoneAndCall();
    await new PendingApprovals(home).answer(
      id,
      HOLD_ANSWER.ONCE,
      'person',
      NOW,
      'ignored',
    );
    expect((await new PendingApprovals(home).read(id))?.answerReason).toBeUndefined();
  });
});

describe('deny from now on', () => {
  it('refuses the call unsigned and puts up a deny rule that carries the reason', async () => {
    const { home, id, device } = await phoneAndCall();
    const said = await confirmAnswer(home, {
      subject: id,
      answer: NEVER_FROM_NOW_ON,
      reason: 'main only moves through review',
      at: NOW,
      principal: { device, driving: false },
    });

    expect(said).toMatchObject({
      ok: true,
      outcome: expect.stringContaining('waits on the Mac'),
    });
    const answered = await new PendingApprovals(home).read(id);
    expect(answered?.answer).toBe(HOLD_ANSWER.DENY);
    expect(answered?.answerReason).toBe('main only moves through review');

    const [card] = await new Proposals(home).open(NOW);
    if (card === undefined || card.change.kind !== 'rules')
      throw new Error('no rule card');
    expect(card.change.rules[0]?.decision).toEqual({
      effect: 'deny',
      reason: 'main only moves through review',
    });
  });

  it('holds once the card is placed and signed, for that agent, action and target only', async () => {
    const { home, id } = await phoneAndCall();
    await confirmAnswer(home, { subject: id, answer: NEVER_FROM_NOW_ON, at: NOW });
    const [card] = await new Proposals(home).open(NOW);
    if (card === undefined) throw new Error('no rule card');
    const mac = personKey();
    await new ConfirmKeys(home).register(mac.point, NOW);
    const placed = await confirmAnswer(home, {
      subject: card.id,
      answer: RULE_SCOPE.MACHINE,
      signature: mac.signs(confirmationMessage(card.id, RULE_SCOPE.MACHINE)),
      at: NOW,
    });
    expect(placed).toMatchObject({ ok: true });

    const engine = new PolicyEngine(await loadPoliciesFromFile(machinePolicyPath(home)));
    const push = { action: 'git.push', target: 'main' };
    const agent = { agentName: 'claude-code' };
    expect(engine.evaluate(push, agent)).toMatchObject({
      effect: 'deny',
      reason: 'a person denied git.push from now on',
    });
    expect(engine.evaluate({ ...push, target: 'feature/x' }, agent).effect).not.toBe(
      'deny',
    );
  });
});
