import { describe, expect, it } from 'vitest';

import {
  asksToRelax,
  PolicyEngine,
  validatePolicyDocument,
  type Policy,
} from '@memnox/core';

const AGENT = { agentName: 'claude-code' };
const PR = { action: 'gh.pr.create', target: 'acme/shop' };

const asks: Policy = {
  name: 'ask-pr-create',
  match: { actions: ['gh.pr.*'] },
  decision: { effect: 'ask', reason: 'a person opens pull requests' },
};

function handedOver(overrides: Partial<Policy> = {}): Policy {
  return {
    name: 'allow-gh-pr-create',
    match: { actions: ['gh.pr.create'], targets: ['acme/shop'] },
    decision: {
      effect: 'allow',
      reason: 'handed over after 12 approvals',
      relaxes: ['ask-pr-create'],
    },
    ...overrides,
  };
}

describe('an allow that names the ask it stands in for', () => {
  it('lets the call run where an allow alone would still be asked about', () => {
    const plain = handedOver({
      decision: { effect: 'allow', reason: 'handed over' },
    });
    expect(new PolicyEngine([asks, plain]).evaluate(PR, AGENT).effect).toBe('ask');
    const verdict = new PolicyEngine([asks, handedOver()]).evaluate(PR, AGENT);
    expect(verdict.effect).toBe('allow');
    expect(verdict.reason).toBe('handed over after 12 approvals');
  });

  it('relaxes only where it matches, so the rest of what the ask covers still asks', () => {
    const engine = new PolicyEngine([asks, handedOver()]);
    expect(engine.evaluate({ ...PR, target: 'acme/billing' }, AGENT).effect).toBe('ask');
    expect(
      engine.evaluate({ action: 'gh.pr.merge', target: 'acme/shop' }, AGENT).effect,
    ).toBe('ask');
  });

  it('never stands in for a deny', () => {
    const denies: Policy = {
      name: 'no-pr-create',
      match: { actions: ['gh.pr.create'] },
      decision: { effect: 'deny', reason: 'frozen' },
    };
    const relaxing = handedOver({
      decision: { effect: 'allow', reason: 'handed over', relaxes: ['no-pr-create'] },
    });
    expect(new PolicyEngine([denies, relaxing]).evaluate(PR, AGENT).effect).toBe('deny');
  });

  it('never relaxes what the workspace asks from this machine', () => {
    const team: Policy = { ...asks, workspace: true };
    expect(new PolicyEngine([team, handedOver()]).evaluate(PR, AGENT).effect).toBe('ask');
  });

  it('is refused on anything but an allow', () => {
    expect(() =>
      validatePolicyDocument({
        version: 1,
        policies: [
          {
            name: 'odd',
            match: { actions: ['gh.pr.create'] },
            decision: { effect: 'ask', relaxes: ['ask-pr-create'] },
          },
        ],
      }),
    ).toThrow(/relaxes is only for an allow/);
  });
});

describe('handing over what was approved often enough', () => {
  it("names the local asks that would hold it, and leaves the team's alone", () => {
    const team: Policy = { ...asks, name: 'team-asks', workspace: true };
    expect(asksToRelax([asks, team], 'gh.pr.create')).toEqual(['ask-pr-create']);
    expect(asksToRelax([asks], 'kubectl.delete')).toEqual([]);
  });

  it('writes an allow that actually stops the asking', () => {
    const allow = handedOver({
      decision: {
        effect: 'allow',
        reason: 'handed over',
        relaxes: asksToRelax([asks], 'gh.pr.create'),
      },
    });
    expect(new PolicyEngine([asks, allow]).evaluate(PR, AGENT).effect).toBe('allow');
  });
});
