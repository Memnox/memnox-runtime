import { describe, expect, it } from 'vitest';
import type { MemnoxEvent } from '../src/event/event';
import type { HoldPrompt, HoldRequest } from '../src/gate/hold';
import { WorkEvidencePrompt } from '../src/gate/work-prompt';
import {
  describeWorkEvidence,
  TESTS_STANDING,
  workEvidenceOf,
} from '../src/session/work-evidence';

const NOW = '2026-10-07T11:00:00.000Z';

function event(minute: number, over: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id: `evt_${minute}`,
    schemaVersion: 1,
    at: `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`,
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'npm.test',
    class: 'read',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

const write = (minute: number, target: string): MemnoxEvent =>
  event(minute, {
    surface: 'mcp',
    operation: 'filesystem.write',
    class: 'write',
    target,
  });

describe('what a session did before it asked', () => {
  it('reads tests that passed with nothing changed since as passing', () => {
    const work = workEvidenceOf([
      write(1, 'src/webhook.ts'),
      event(2, { exitCode: 1 }),
      write(3, 'src/webhook.ts'),
      event(4, { exitCode: 0 }),
    ]);
    expect(work.tests).toBe(TESTS_STANDING.PASSED);
    expect(work.recovered).toBe(1);
    expect(work.failing).toEqual([]);
    expect(describeWorkEvidence(work, NOW)[0]).toBe(
      'tests: npm test passed 56m ago, and nothing changed since',
    );
  });

  it('says a pass is stale once files changed after it', () => {
    const work = workEvidenceOf([event(1, { exitCode: 0 }), write(2, 'src/a.ts')]);
    expect(work.tests).toBe(TESTS_STANDING.STALE);
    expect(work.changedSinceTests).toBe(1);
  });

  it('finds a test run typed through the shell', () => {
    const work = workEvidenceOf([
      event(1, { operation: 'shell.execute', target: 'pnpm test --run', exitCode: 1 }),
    ]);
    expect(work.tests).toBe(TESTS_STANDING.FAILED);
  });

  it('says so when no tests ran, rather than leaving the line out', () => {
    const lines = describeWorkEvidence(workEvidenceOf([write(1, 'src/a.ts')]), NOW);
    expect(lines).toContain('tests: none run in this session');
    expect(lines).toContain('changed: 1 file(s), src/a.ts');
    expect(lines).toContain('outside: nothing changed outside this machine yet');
  });

  it('leaves out what a rule refused, since it never ran', () => {
    const work = workEvidenceOf([event(1, { effect: 'deny', exitCode: 0 })]);
    expect(work.tests).toBe(TESTS_STANDING.NONE);
  });
});

const request: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'gh.pr.merge',
  fingerprint: 'f',
  reason: 'merging asks',
  evidence: ['    rule  merge-asks'],
};

describe('a held call carries the work behind it', () => {
  it('adds the work under the rule, in the same column', async () => {
    const seen: HoldRequest[] = [];
    const inner: HoldPrompt = {
      ask: async (asked) => {
        seen.push(asked);
        return null;
      },
    };
    const prompt = new WorkEvidencePrompt(inner, async () => [
      'tests: npm test passed 2m ago, and nothing changed since',
    ]);
    await prompt.ask(request, 1000);
    expect(seen[0]?.evidence).toEqual([
      '    rule  merge-asks',
      '    tests  npm test passed 2m ago, and nothing changed since',
    ]);
  });

  it('still asks when the ledger cannot be read', async () => {
    const seen: HoldRequest[] = [];
    const prompt = new WorkEvidencePrompt(
      {
        ask: async (asked) => {
          seen.push(asked);
          return null;
        },
      },
      async () => {
        throw new Error('locked');
      },
    );
    await prompt.ask(request, 1000);
    expect(seen[0]).toEqual(request);
  });
});

describe('evidence never carries a secret to a terminal or a phone', () => {
  it('masks a token in a failing command', () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const work = workEvidenceOf([
      event(1, {
        operation: 'shell.execute',
        target: `curl -H "Authorization: Bearer ${token}" https://api.github.com`,
        exitCode: 1,
      }),
    ]);
    const lines = describeWorkEvidence(work, NOW).join('\n');
    expect(lines).toContain('failing:');
    expect(lines).not.toContain(token);
  });
});
