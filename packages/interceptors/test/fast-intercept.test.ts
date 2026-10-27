import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configPathFor,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  INTERCEPT_PLAN,
  LocalGate,
  SessionPauses,
  type EnforcementMode,
} from '@memnox/core';

import {
  commandEventFor,
  finishedRow,
  interceptorDirFor,
  planIntercept,
  type FastScene,
} from '../src/index';

const REAL = '/usr/bin';

function gate(effect: string, action: string): LocalGate {
  return new LocalGate(
    [
      {
        name: 'the-rule',
        match: { actions: [action] },
        decision: { effect: effect as never, reason: 'history is shared' },
      } as never,
    ],
    { agentName: 'claude-code' },
  );
}

/** A machine past its first run, since one with no settings yet observes everything. */
async function machine(
  mode: EnforcementMode = ENFORCEMENT_MODE.ENFORCE,
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-fast-'));
  const path = configPathFor(home);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `mode = "${mode}"\n`);
  return home;
}

function scene(home: string, argv: string[], env: NodeJS.ProcessEnv = {}): FastScene {
  return {
    argv,
    env: {
      HOME: home,
      PATH: `${interceptorDirFor(home)}:${REAL}`,
      CLAUDECODE: '1',
      MEMNOX_SESSION: 'ses_fast',
      ...env,
    },
    cwd: home,
    ppid: 1,
  };
}

function deps(home: string, rules: LocalGate | null = null) {
  return {
    home,
    ownCwd: home,
    ownEnv: {},
    ancestors: (): string[][] => [],
    exists: (candidate: string): boolean =>
      ['ls', 'git', 'gh', 'rm'].some((name) => candidate === `${REAL}/${name}`),
    gateFor: async (): Promise<LocalGate | null> => rules,
    now: (): Date => new Date('2026-10-08T10:00:00.000Z'),
  };
}

describe('the daemon planning a command for the native wrapper', () => {
  it('runs what no rule covers, from PATH without the shims, and keeps the row for after', async () => {
    const home = await machine();
    const plan = await planIntercept(scene(home, ['ls', '-la']), deps(home));
    expect(plan.kind).toBe(INTERCEPT_PLAN.RUN);
    if (plan.kind !== INTERCEPT_PLAN.RUN) return;
    expect(plan.real).toBe(`${REAL}/ls`);
    expect(plan.path).toBe(REAL);
    expect(plan.pending.row.effect).toBe(DECISION_EFFECT.ALLOW);
    expect(plan.pending.row.sessionId).toBe('ses_fast');
    // A digest only in the row, as on every other path.
    expect(JSON.stringify(commandEventFor(plan.pending.row))).not.toContain('-la');
    const row = finishedRow(plan.pending, 0, () => new Date('2026-10-08T10:00:01.000Z'));
    expect(row.exitCode).toBe(0);
    expect(row.durationMs).toBe(1000);
  });

  it('passes a person straight through with nothing recorded', async () => {
    const home = await machine();
    const plan = await planIntercept(
      scene(home, ['ls'], { CLAUDECODE: '', MEMNOX_SESSION: '' }),
      deps(home),
    );
    expect(plan).toEqual({ kind: INTERCEPT_PLAN.PASS, real: `${REAL}/ls`, path: REAL });
  });

  it('refuses what a rule denies, with the row the Node interceptor would write', async () => {
    const home = await machine();
    const plan = await planIntercept(
      scene(home, ['git', 'push', '--force']),
      deps(home, gate(DECISION_EFFECT.DENY, 'git.push-force')),
    );
    expect(plan.kind).toBe(INTERCEPT_PLAN.REFUSE);
    if (plan.kind !== INTERCEPT_PLAN.REFUSE) return;
    expect(plan.exitCode).toBe(1);
    expect(plan.notes.join('\n')).toContain('Denied by Memnox: history is shared');
    expect(plan.row?.effect).toBe(DECISION_EFFECT.DENY);
  });

  it('runs what a rule denies in observe, with the verdict kept on the row', async () => {
    const home = await machine(ENFORCEMENT_MODE.OBSERVE);
    // A read, since a push or a delete goes to the Node interceptor whatever the mode.
    const plan = await planIntercept(
      scene(home, ['git', 'log']),
      deps(home, gate(DECISION_EFFECT.DENY, 'git.log')),
    );
    expect(plan.kind).toBe(INTERCEPT_PLAN.RUN);
    if (plan.kind !== INTERCEPT_PLAN.RUN) return;
    expect(plan.notes).toEqual([]);
    const row = commandEventFor(plan.pending.row);
    expect(row.effect).toBe(DECISION_EFFECT.ALLOW);
    expect(row.mode).toBe(ENFORCEMENT_MODE.OBSERVE);
    expect(row.shadowEffect).toBe(DECISION_EFFECT.DENY);
  });

  it('refuses a paused session without a row, as the Node interceptor does', async () => {
    const home = await machine();
    await new SessionPauses(home).pause({
      sessionId: 'ses_fast',
      signal: 'error-loop',
      reason: 'the same failure eleven times',
      reached: 11,
      ceiling: 10,
      pausedAt: '2026-10-08T09:00:00.000Z',
      lastAction: 'npm.test',
    } as never);
    const plan = await planIntercept(scene(home, ['ls']), deps(home));
    expect(plan.kind).toBe(INTERCEPT_PLAN.REFUSE);
    if (plan.kind !== INTERCEPT_PLAN.REFUSE) return;
    expect(plan.row).toBeUndefined();
    expect(plan.notes[0]).toContain('Paused by Memnox');
  });

  it.each([
    ['a rule that asks a person', ['git', 'push', '--force'], {}, DECISION_EFFECT.ASK],
    ['a repository git would find elsewhere', ['ls'], { GIT_DIR: 'other/.git' }, null],
    [
      'a brokered credential',
      ['ls'],
      { MEMNOX_CREDENTIAL_BROKER: '/tmp/broker.sock' },
      null,
    ],
    ['another home', ['ls'], { HOME: '/somewhere/else' }, null],
    ['a binary not on PATH', ['nothere'], {}, null],
    ['our own name', ['memnox-intercept', 'git'], {}, null],
    ['a command that destroys work', ['rm', '-rf', 'build'], {}, null],
    ['a pull request another agent may hold', ['gh', 'pr', 'merge', '12'], {}, null],
    ['a push, which reads the checkout', ['git', 'push', 'origin', 'main'], {}, null],
  ])('hands %s to the Node interceptor', async (_, argv, env, effect) => {
    const home = await machine();
    const rules = effect === null ? null : gate(effect, 'git.push-force');
    const plan = await planIntercept(scene(home, argv, env), deps(home, rules));
    expect(plan.kind).toBe(INTERCEPT_PLAN.NODE);
  });
});
