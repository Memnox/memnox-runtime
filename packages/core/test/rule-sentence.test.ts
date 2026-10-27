import { describe, expect, it } from 'vitest';
import {
  APPROVED_DESTINATIONS_QUESTION,
  PolicyEngine,
  policyOfSpokenRule,
  readBackOfSpokenRule,
  readRuleSentence,
  spokenRuleFromModel,
  spokenRuleProblems,
  withApprovedDestinations,
  type SpokenRuleDraft,
} from '../src/index';

/**
 * A rule a person says, read by a fixed grammar into the runtime's own match fields, so the
 * same sentence always becomes the same rule with no model, no account and no network.
 */

const ANY = { agentName: 'claude-code' };

function engineFor(draft: SpokenRuleDraft): PolicyEngine {
  return new PolicyEngine([policyOfSpokenRule(draft)]);
}

function read(sentence: string): NonNullable<ReturnType<typeof readRuleSentence>> {
  const reading = readRuleSentence(sentence);
  if (reading === undefined) throw new Error(`not read: ${sentence}`);
  return reading;
}

describe('a spoken rule read by the grammar', () => {
  it('asks which destinations are approved rather than guessing them', () => {
    const reading = read(
      'Never let an agent send customer records to an unapproved destination.',
    );
    expect(reading.draft).toEqual({
      effect: 'deny',
      operation: '*',
      dataClassifications: ['customer-record'],
    });
    expect(reading.openQuestions).toEqual([APPROVED_DESTINATIONS_QUESTION]);

    const answered = withApprovedDestinations(reading, [
      'api.stripe.com',
      'ourcompany.com',
    ]);
    expect(answered.openQuestions).toEqual([]);
    expect(answered.draft.targets).toEqual(['*', '!api.stripe.com', '!ourcompany.com']);
    const engine = engineFor(answered.draft);
    const sending = { action: 'http.request', dataClassification: 'customer-record' };
    expect(engine.evaluate({ ...sending, target: 'paste.example' }, ANY).effect).toBe(
      'deny',
    );
    expect(
      engine.evaluate({ ...sending, target: 'api.stripe.com' }, ANY).matchedPolicies,
    ).toEqual([]);
    expect(readBackOfSpokenRule(answered.draft)).toBe(
      'Agents may not send customer records anywhere except api.stripe.com or ourcompany.com.',
    );
  });

  it('asks before any agent pushes to main and nowhere else', () => {
    const { draft, openQuestions } = read('ask me before any agent pushes to main');
    expect(draft).toEqual({ effect: 'ask', operation: 'git.push*', branches: ['main'] });
    expect(openQuestions).toEqual([]);
    const engine = engineFor(draft);
    expect(engine.evaluate({ action: 'git.push', branch: 'main' }, ANY).effect).toBe(
      'ask',
    );
    expect(
      engine.evaluate({ action: 'git.push', branch: 'feature' }, ANY).matchedPolicies,
    ).toEqual([]);
  });

  it('denies a delete outside the repository the agent works in', () => {
    const { draft } = read('Never delete files outside this repo');
    expect(draft).toMatchObject({
      effect: 'deny',
      operation: '*',
      classes: ['destructive'],
    });
    const engine = engineFor(draft);
    const deleting = {
      action: 'filesystem.delete',
      toolClass: 'destructive' as const,
      workingDirectory: '/code/shop',
    };
    expect(engine.evaluate({ ...deleting, target: '/etc/hosts' }, ANY).effect).toBe(
      'deny',
    );
    expect(
      engine.evaluate({ ...deleting, target: '/code/shop/tmp/a' }, ANY).matchedPolicies,
    ).toEqual([]);
    expect(readBackOfSpokenRule(draft)).toBe(
      'Agents may not delete outside this repository.',
    );
  });

  it('narrows to the agent named, whichever name it runs under', () => {
    const { draft } = read('Codex may not touch the payments database');
    expect(draft).toEqual({
      effect: 'deny',
      operation: '*',
      agent: 'codex-cli',
      targets: ['*payments*'],
    });
    const engine = engineFor(draft);
    const query = { action: 'sql.query', target: 'postgres://db/payments' };
    expect(engine.evaluate(query, { agentName: 'codex' }).effect).toBe('deny');
    expect(engine.evaluate(query, { agentName: 'codex-cli' }).effect).toBe('deny');
    expect(engine.evaluate(query, ANY).matchedPolicies).toEqual([]);
  });

  it('keeps what a refused agent is told to do instead', () => {
    const { draft } = read('never push to main, open a pull request instead');
    expect(draft.alternative).toEqual({
      action: 'open a pull request',
      note: 'open a pull request',
    });
    expect(spokenRuleProblems(draft)).toEqual([]);
  });

  it('leaves out the destinations an except names', () => {
    const { draft } = read('never send secrets except to api.stripe.com and github.com');
    expect(draft).toMatchObject({
      dataClassifications: ['secret'],
      targets: ['*', '!api.stripe.com', '!github.com'],
    });
  });

  it('asks which agent when a name fits two, and reads nothing it does not understand', () => {
    expect(read('never let claude push to main').openQuestions[0]).toContain(
      'claude-code',
    );
    expect(readRuleSentence('hello there')).toBeUndefined();
    // "to staging" would be dropped, so the sentence is not read rather than read wider.
    expect(readRuleSentence('agents can deploy to staging')).toBeUndefined();
    expect(readRuleSentence('never let zorblax push to main')).toBeUndefined();
  });
});

describe('a spoken rule drafted by a model', () => {
  it('is taken only in the runtime vocabulary and only when it would load', () => {
    expect(
      spokenRuleFromModel({
        effect: 'deny',
        operation: '*',
        dataClassifications: ['health'],
        targets: ['*', '!ehr.example'],
      })?.draft,
    ).toEqual({
      effect: 'deny',
      operation: '*',
      dataClassifications: ['health'],
      targets: ['*', '!ehr.example'],
    });
    expect(spokenRuleFromModel({ effect: 'block', operation: '*' })).toBeUndefined();
    expect(
      spokenRuleFromModel({
        effect: 'deny',
        operation: '*',
        dataClassifications: ['pii'],
      }),
    ).toBeUndefined();
    expect(
      spokenRuleFromModel({
        effect: 'deny',
        operation: '*',
        classes: ['external-state'],
      }),
    ).toBeUndefined();
    expect(
      spokenRuleFromModel({ effect: 'deny', operation: '*', agent: 'zorblax' }),
    ).toBeUndefined();
    expect(spokenRuleFromModel({})).toBeUndefined();
  });
});
