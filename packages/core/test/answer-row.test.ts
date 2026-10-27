import { describe, expect, it } from 'vitest';
import { answerRow } from '../src/gate/answer-row';
import { HOLD_ANSWER, type HoldRequest } from '../src/gate/hold';

const REQUEST: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

describe("a person's answer, as a row in the agent's session", () => {
  it('names who let it through and in what words', () => {
    const row = answerRow({
      request: REQUEST,
      answer: HOLD_ANSWER.ONCE,
      by: 'person (Touch ID)',
      said: 'yeah go ahead, just this once',
      at: '2026-09-30T12:00:00.000Z',
    });
    expect(row).toMatchObject({
      sessionId: 'ses_1',
      agent: 'claude-code',
      actorType: 'human',
      principal: 'person (Touch ID)',
      operation: 'git.push',
      target: 'main',
      effect: 'allow',
      authorizedBy: 'person (Touch ID)',
    });
    expect(row.reason).toContain('saying "yeah go ahead, just this once"');
  });

  it('records a refusal as one, releasing nobody', () => {
    const row = answerRow({
      request: REQUEST,
      answer: HOLD_ANSWER.DENY,
      by: 'person (voice)',
      at: 'now',
    });
    expect(row.effect).toBe('deny');
    expect(row.authorizedBy).toBeUndefined();
    expect(row.reason).not.toContain('saying');
  });

  it('masks a secret the person read out', () => {
    const row = answerRow({
      request: REQUEST,
      answer: HOLD_ANSWER.ONCE,
      by: 'person (Touch ID)',
      said: 'use token=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      at: 'now',
    });
    expect(row.reason).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
