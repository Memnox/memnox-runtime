import { describe, expect, it } from 'vitest';
import {
  activityKindOf,
  almostReady,
  answeredHowOf,
  AUTONOMY,
  cursorOf,
  isPastCursor,
  ladderOf,
  MINIMUM_EVIDENCE,
  policyOfRuleDraft,
  readBackOfRuleDraft,
  readCursor,
  ruleDraftProblems,
  rulePackToml,
  rulesOfPack,
  sentenceOfRule,
  weeksOfProgress,
  type Delegation,
  type MemnoxEvent,
  type Policy,
} from '../src/index';

/** The pure halves of the Policy Studio and the activity screen. */

const NOW = new Date('2026-10-30T12:00:00.000Z');

function event(at: string, fields: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id: at,
    schemaVersion: 1,
    at,
    sessionId: 's',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'npm.test',
    class: 'read',
    effect: 'allow',
    mode: 'enforce',
    reason: 'r',
    ...fields,
  } as MemnoxEvent;
}

function delegation(action: string, approvals: number, denials: number): Delegation {
  return {
    action,
    approvals,
    denials,
    lastAt: NOW.toISOString(),
    class: 'write',
    targets: [],
    recommendation: AUTONOMY.ASSIST,
    because: '',
  };
}

describe('a rule drafted on a form', () => {
  it('becomes a rule matching every field it names, read back in plain words', () => {
    const draft = {
      effect: 'deny' as const,
      action: 'git.push*',
      reason: '',
      agents: ['claude-code', 'codex-cli'],
      workingDirectories: ['/srv/*'],
    };
    const rule = policyOfRuleDraft(draft);
    expect(rule.match.agents).toContain('codex');
    expect(rule.match.workingDirectories).toEqual(['/srv/*']);
    expect(rule.decision.reason).toBe(readBackOfRuleDraft(draft));
    expect(readBackOfRuleDraft(draft)).toContain('Only for claude-code, codex-cli.');
    expect(ruleDraftProblems(draft)).toEqual([]);
  });

  it('is refused with a class nobody classifies', () => {
    expect(
      ruleDraftProblems({ effect: 'ask', action: 'x', reason: '', classes: ['magic'] }),
    ).toEqual(['no such class: magic']);
  });

  it('says any rule in force the same way', () => {
    const rule: Policy = {
      name: 'n',
      match: { actions: ['git.push*'], branches: ['main'] },
      decision: { effect: 'deny' },
    };
    expect(sentenceOfRule(rule)).toBe('Agents may not push to main.');
  });
});

describe('a rule pack', () => {
  it('round trips, and never speaks for the workspace', () => {
    const rule: Policy = {
      name: 'team',
      match: { actions: ['deploy'] },
      decision: { effect: 'ask' },
      workspace: true,
      decidedBy: 'someone',
    };
    const read = rulesOfPack(rulePackToml([rule]));
    expect(read).toEqual({
      rules: [
        { name: 'team', match: { actions: ['deploy'] }, decision: { effect: 'ask' } },
      ],
    });
  });

  it('is refused whole when any rule will not load', () => {
    expect('problems' in rulesOfPack('version = 1\n[[policies]]\nname = "x"\n')).toBe(
      true,
    );
    expect(rulesOfPack('not toml = = =')).toHaveProperty('problems');
  });
});

describe('an activity row', () => {
  it('names its kind and how it was let through', () => {
    expect(activityKindOf('git')).toBe('command');
    expect(activityKindOf('filesystem')).toBe('file');
    expect(activityKindOf('network')).toBe('tool');
    expect(answeredHowOf('person (inside the session)')).toBe('within-session');
    expect(answeredHowOf('person (voice)')).toBe('other');
    expect(answeredHowOf('person (iPhone)')).toBe('signed');
  });

  it('pages by a cursor of moment and id', () => {
    const cursor = readCursor(cursorOf({ at: '2026-10-30T10:00:00Z', id: 'b' }));
    expect(cursor).toEqual({ at: '2026-10-30T10:00:00Z', id: 'b' });
    if (cursor === null) return;
    expect(isPastCursor({ at: '2026-10-30T10:00:00Z', id: 'a' }, cursor)).toBe(true);
    expect(isPastCursor({ at: '2026-10-30T10:00:00Z', id: 'c' }, cursor)).toBe(false);
    expect(readCursor('nonsense')).toBeNull();
  });
});

describe('progress', () => {
  it('counts what is almost a habit, and never one somebody refused', () => {
    const found = [delegation('a', 3, 0), delegation('b', 3, 1), delegation('c', 6, 0)];
    expect(almostReady(found)).toEqual([{ action: 'a', approvals: 3, needed: 2 }]);
  });

  it('names the next rung and what it asks of the record', () => {
    const ladder = ladderOf(AUTONOMY.SUPERVISED, { actions: 10, asks: 1 });
    expect(ladder.next).toBe(AUTONOMY.AUTONOMOUS);
    expect(ladder.needs).toContain(String(MINIMUM_EVIDENCE));
    expect(ladderOf(AUTONOMY.TRUSTED, { actions: 0, asks: 0 }).next).toBeUndefined();
  });

  it('counts this week and last in asks, autopilot allows and grants', () => {
    const events = [
      event('2026-10-29T00:00:00.000Z', { effect: 'ask' }),
      event('2026-10-29T01:00:00.000Z', { signals: ['allowance:ern_ab12'] }),
      event('2026-10-29T02:00:00.000Z', { signals: ['allowance:alw_1'] }),
      event('2026-10-29T03:00:00.000Z', {
        surface: 'config',
        operation: 'autopilot.granted',
      }),
      event('2026-10-20T00:00:00.000Z', { effect: 'ask' }),
    ];
    const { thisWeek, lastWeek } = weeksOfProgress(events, NOW);
    expect(thisWeek).toMatchObject({ asked: 1, answeredByAutopilot: 1, handedOver: 1 });
    expect(lastWeek).toMatchObject({ asked: 1, answeredByAutopilot: 0, handedOver: 0 });
  });
});
