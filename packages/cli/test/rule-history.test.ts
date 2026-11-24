import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  POLICY_METHOD,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  sentenceOfRule,
  type Policy,
} from '@memnox/core';
import { policiesAnswer } from '../src/daemon/policies-answer';

/** The rule changes a person answered here, newest first, so Rules can say what changed and who said so. */

const RULE: Policy = {
  name: 'no-railway-deploy',
  match: { actions: ['railway.deploy'] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'production deploys need a person' },
} as Policy;
const NOW = new Date('2026-11-23T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

describe('rule history', () => {
  it('lists answered rule changes newest first, leaving out what still waits and what is not a rule', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-rule-history-'));
    const proposals = new Proposals(home);
    const added = await proposals.propose({
      change: {
        kind: PROPOSAL_KIND.RULES,
        file: join(home, 'rules.toml'),
        rules: [RULE],
      },
      rationale: 'deny deploys',
      proposedBy: 'agt_memnox-operator',
      at: at(5),
      ttlMs: HOUR,
    });
    await proposals.answer(added.id, PROPOSAL_ANSWER.CONFIRMED, 'Ana', at(4.5));
    const removed = await proposals.propose({
      change: {
        kind: PROPOSAL_KIND.RULE_REMOVE,
        file: join(home, 'rules.toml'),
        rule: 'ask-before-push',
      },
      rationale: 'take it out',
      proposedBy: 'Ana',
      at: at(2),
      ttlMs: HOUR,
    });
    await proposals.answer(removed.id, PROPOSAL_ANSWER.DECLINED, 'Ana', at(1.5));
    await proposals.propose({
      change: {
        kind: PROPOSAL_KIND.RULES,
        file: join(home, 'rules.toml'),
        rules: [RULE],
      },
      rationale: 'waiting',
      proposedBy: 'Ana',
      at: at(0.1),
      ttlMs: HOUR,
    });
    const resume = await proposals.propose({
      change: { kind: PROPOSAL_KIND.RESUME, sessionId: 'ses_1' },
      rationale: 'carry on',
      proposedBy: 'Ana',
      at: at(1),
      ttlMs: HOUR,
    });
    await proposals.answer(resume.id, PROPOSAL_ANSWER.CONFIRMED, 'Ana', at(0.9));

    const answer = await policiesAnswer(
      home,
      { id: 1, method: POLICY_METHOD.RULE_HISTORY },
      { now: NOW, env: {} },
    );
    expect(answer.ok).toBe(true);
    expect(answer.ruleHistory).toEqual([
      {
        id: removed.id,
        kind: 'removed',
        rules: ['ask-before-push'],
        answer: 'declined',
        answeredAt: at(1.5),
        answeredBy: 'Ana',
        proposedBy: 'Ana',
      },
      {
        id: added.id,
        kind: 'added',
        rules: [sentenceOfRule(RULE)],
        answer: 'confirmed',
        answeredAt: at(4.5),
        answeredBy: 'Ana',
        proposedBy: 'agt_memnox-operator',
      },
    ]);
  });
});
