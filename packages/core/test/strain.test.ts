import { describe, expect, it } from 'vitest';
import { DECISION_EFFECT } from '../src/constants/decision.constants';
import { TOOL_CLASS } from '../src/discovery/classify';
import { LocalGate, STRAIN_SIGNAL } from '../src/gate/local-gate';
import type { Policy } from '../src/policy/index';
import type { ActionOutcome } from '../src/session/breaker';
import {
  describeStrain,
  isStrained,
  strainOf,
  type SessionStrain,
} from '../src/session/strain';

let minute = 0;
const outcome = (fingerprint: string, failed: boolean): ActionOutcome => {
  minute += 1;
  return {
    sessionId: 'ses_1',
    fingerprint,
    action: fingerprint.split(':')[0] ?? fingerprint,
    at: `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`,
    failed,
  };
};

describe('strain, counted from failures nothing has got past', () => {
  it('counts failures that still stand', () => {
    const strain = strainOf([
      outcome('npm.test:', true),
      outcome('npm.test:', true),
      outcome('gh.pr:create', true),
    ]);
    expect(strain.unresolved).toBe(3);
    // Most recent first, since that is the one the agent is fighting now.
    expect(strain.failing).toEqual(['gh.pr', 'npm.test']);
    expect(strain.recovered).toBe(0);
  });

  it('turns failures the same work later got past into recoveries', () => {
    const strain = strainOf([
      outcome('npm.test:', true),
      outcome('npm.test:', true),
      outcome('file.write:src/a.ts', false),
      outcome('npm.test:', false),
    ]);
    expect(strain.unresolved).toBe(0);
    expect(strain.recovered).toBe(2);
    expect(isStrained(strain)).toBe(false);
  });

  it('names what is failing in the reason, so the person knows what they are trusting', () => {
    const strain = strainOf([
      outcome('npm.test:', true),
      outcome('npm.test:', true),
      outcome('npm.test:', true),
    ]);
    expect(isStrained(strain)).toBe(true);
    expect(describeStrain(strain)).toContain('3 failures it has not got past (npm.test)');
  });
});

const allowAll: Policy = {
  name: 'allow-all',
  match: { actions: ['*'] },
  decision: { effect: DECISION_EFFECT.ALLOW, reason: 'allowed' },
};

const strained: SessionStrain = { unresolved: 3, failing: ['npm.test'], recovered: 0 };

const gate = (strain: SessionStrain | null): LocalGate =>
  new LocalGate([allowAll], { agentName: 'claude-code', strain });

describe('a struggling session keeps working here and asks before reaching further', () => {
  it('asks before a change outside this machine', () => {
    const verdict = gate(strained).evaluate({
      action: 'gh.pr.merge',
      toolClass: TOOL_CLASS.WRITE,
    });
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.signals).toContain(STRAIN_SIGNAL);
  });

  it('asks before deleting, even on this machine', () => {
    const verdict = gate(strained).evaluate({
      action: 'filesystem.delete',
      toolClass: TOOL_CLASS.DESTRUCTIVE,
      target: '/repo/src',
    });
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
  });

  it('lets it keep editing files and reading systems', () => {
    expect(
      gate(strained).evaluate({
        action: 'filesystem.write',
        toolClass: TOOL_CLASS.WRITE,
        target: '/repo/src/a.ts',
      }).effect,
    ).toBe(DECISION_EFFECT.ALLOW);
    expect(
      gate(strained).evaluate({ action: 'gh.pr.view', toolClass: TOOL_CLASS.READ })
        .effect,
    ).toBe(DECISION_EFFECT.ALLOW);
  });

  it('changes nothing for a session below the threshold', () => {
    const verdict = gate({ unresolved: 2, failing: ['npm.test'], recovered: 0 }).evaluate(
      {
        action: 'gh.pr.merge',
        toolClass: TOOL_CLASS.WRITE,
      },
    );
    expect(verdict.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('never loosens a refusal', () => {
    const deny: Policy = {
      name: 'no-merge',
      match: { actions: ['gh.pr.merge'] },
      decision: { effect: DECISION_EFFECT.DENY, reason: 'no merging' },
    };
    const verdict = new LocalGate([deny], {
      agentName: 'claude-code',
      strain: strained,
    }).evaluate({
      action: 'gh.pr.merge',
      toolClass: TOOL_CLASS.WRITE,
    });
    expect(verdict.effect).toBe(DECISION_EFFECT.DENY);
  });
});
