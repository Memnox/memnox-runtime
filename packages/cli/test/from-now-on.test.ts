import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  loadPoliciesFromFile,
  PendingApprovals,
  PolicyEngine,
  Proposals,
  RULE_SCOPE,
  writePolicyDocumentFile,
  type HoldRequest,
} from '@memnox/core';

import { confirmAnswer } from '../src/daemon/confirm';
import { FROM_NOW_ON } from '../src/daemon/from-now-on';
import { machinePolicyPath } from '../src/protect/machine-rules';
import { registerPolicyFile } from '../src/policy-registry';

/**
 * "Allow from now on" on a held call: the call runs once, and the rule that stops the next
 * identical one asking waits on a card, placed and signed by the person like any other rule.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const AGENT = { agentName: 'claude-code' };
const HELD: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'gh.pr.create',
  target: 'acme/shop',
  fingerprint: '0123456789abcdef',
  reason: 'a person opens pull requests',
  rule: 'ask-pr',
};

interface Machine {
  home: string;
  rules: string;
  signs: (subject: string, answer: string) => string;
}

async function machine(): Promise<Machine> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-from-now-on-'));
  const rules = join(home, 'team-rules.toml');
  await writePolicyDocumentFile(rules, {
    version: 1,
    policies: [
      {
        name: 'ask-pr',
        match: { actions: ['gh.pr.*'] },
        decision: { effect: 'ask', reason: 'a person opens pull requests' },
      },
    ],
  });
  await registerPolicyFile(home, rules);
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW,
  );
  return {
    home,
    rules,
    signs: (subject, answer) => signWith(privateKey, subject, answer),
  };
}

function signWith(key: KeyObject, subject: string, answer: string): string {
  return sign('sha256', Buffer.from(confirmationMessage(subject, answer)), key).toString(
    'base64',
  );
}

describe('allowing a held call from now on', () => {
  it('runs it once, then a signed rule card stops the next identical call asking', async () => {
    const { home, rules, signs } = await machine();
    const held = await new PendingApprovals(home).raise(HELD, NOW, 120_000);

    const answered = await confirmAnswer(home, {
      subject: held.id,
      answer: FROM_NOW_ON,
      signature: signs(held.id, FROM_NOW_ON),
      at: NOW,
    });
    expect(answered).toMatchObject({ ok: true });
    expect((await new PendingApprovals(home).read(held.id))?.answer).toBe('once');

    const [card] = await new Proposals(home).open(NOW);
    if (card === undefined) throw new Error('no rule card proposed');
    expect(card.change).toMatchObject({ kind: 'rules' });

    const placed = await confirmAnswer(home, {
      subject: card.id,
      answer: RULE_SCOPE.MACHINE,
      signature: signs(card.id, RULE_SCOPE.MACHINE),
      at: NOW,
    });
    expect(placed).toMatchObject({ ok: true });

    const engine = new PolicyEngine([
      ...(await loadPoliciesFromFile(rules)),
      ...(await loadPoliciesFromFile(machinePolicyPath(home))),
    ]);
    const pr = { action: 'gh.pr.create', target: 'acme/shop' };
    expect(engine.evaluate(pr, AGENT).effect).toBe('allow');
    expect(engine.evaluate({ ...pr, target: 'acme/billing' }, AGENT).effect).toBe('ask');
    expect(engine.evaluate(pr, { agentName: 'cursor' }).effect).toBe('ask');
  });

  it('answers a delete once and proposes nothing from now on', async () => {
    const { home, signs } = await machine();
    const held = await new PendingApprovals(home).raise(
      { ...HELD, operation: 'gh.repo.delete', class: 'destructive' },
      NOW,
      120_000,
    );
    const answered = await confirmAnswer(home, {
      subject: held.id,
      answer: FROM_NOW_ON,
      signature: signs(held.id, FROM_NOW_ON),
      at: NOW,
    });
    expect(answered).toMatchObject({
      ok: true,
      outcome: expect.stringContaining('never from now on'),
    });
    expect(await new Proposals(home).open(NOW)).toEqual([]);
  });

  it('will not take from now on unsigned', async () => {
    const { home } = await machine();
    const held = await new PendingApprovals(home).raise(HELD, NOW, 120_000);
    const answered = await confirmAnswer(home, {
      subject: held.id,
      answer: FROM_NOW_ON,
      at: NOW,
    });
    expect(answered.ok).toBe(false);
  });
});
