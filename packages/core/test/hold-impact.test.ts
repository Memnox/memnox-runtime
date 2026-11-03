import { describe, expect, it } from 'vitest';

import { CLAIM_BASIS, holdImpact, plainAsk } from '../src/index';

/**
 * What a held action could affect, whether it can be undone and what was
 * verified, each with how it is known. Unknown stays unknown, an inference is
 * only ever "may", and nothing that left the machine carries a secret.
 */

describe('a held action, explained', () => {
  it('names what it would affect from the request, and says so where nothing names it', () => {
    expect(holdImpact({ operation: 'filesystem.delete', target: 'build/', class: 'destructive' }).affected).toEqual({
      text: 'It would affect build/.',
      basis: CLAIM_BASIS.RECORDED,
      source: 'the action as the agent asked for it',
    });
    expect(holdImpact({ operation: 'shell.execute' }).affected.basis).toBe(CLAIM_BASIS.UNKNOWN);
  });

  it('only ever says "may" about undoing, and unknown where nothing classified the action', () => {
    const sent = holdImpact({ operation: 'gmail.send', class: 'communication' }).undo;
    expect(sent.basis).toBe(CLAIM_BASIS.INFERRED);
    expect(sent.text).toContain('may not be undoable');
    const unclassified = holdImpact({ operation: 'stripe.refund' }).undo;
    expect(unclassified).toMatchObject({
      basis: CLAIM_BASIS.UNKNOWN,
      text: 'Not established whether this can be undone.',
    });
  });

  it('says what was verified, and that no tests have run where none have', () => {
    const [captured, tests] = holdImpact({ operation: 'git.push' }).verified;
    expect(captured?.basis).toBe(CLAIM_BASIS.RECORDED);
    expect(tests).toMatchObject({
      basis: CLAIM_BASIS.UNKNOWN,
      text: 'No test results are available yet.',
    });
  });

  it('names a recorded test result as recorded', () => {
    const work = {
      tests: 'failed' as const,
      testCommand: 'npm test',
      changedSinceTests: 0,
      filesChanged: [],
      outside: [],
      recovered: 0,
      failing: [],
    };
    expect(holdImpact({ operation: 'git.push' }, work).verified[1]).toMatchObject({
      basis: CLAIM_BASIS.RECORDED,
      text: 'The tests last failed (npm test).',
    });
  });

  it('carries no secret a target held', () => {
    const ask = plainAsk({
      agent: 'claude-code',
      operation: 'http.request',
      target: 'https://user:hunter2-secret-password@api.example.com',
      reason: 'you chose to be asked about this',
      class: 'communication',
    });
    expect(JSON.stringify(ask.impact)).not.toContain('hunter2-secret-password');
  });
});
