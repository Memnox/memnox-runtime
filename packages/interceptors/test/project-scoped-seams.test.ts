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
  TOOL_CLASS,
  type Policy,
} from '@memnox/core';
import { EDIT_HOST } from '../src/agent-edits';
import { planIntercept } from '../src/fast-intercept';
import { HookAuthorizer } from '../src/hook-authorizer';
import { ruleOnCommand } from '../src/interceptor';
import { ShellSeam } from '../src/shell-seam';
import { ruleOnTool } from '../src/tool-policy';

/**
 * A rule scoped to one project decides an action only where the seam that built the request said
 * which project it runs in, read off the folder: here, every seam that builds one.
 */

const BILLING = '/work/billing';
const ELSEWHERE = '/work/scratch';
const PROJECT = 'billing-pack';

/** Billing's own rule: nothing there is pushed by force, while every other folder is left alone. */
function billingGate(action: string): LocalGate {
  const rule: Policy = {
    name: 'billing-history-is-shared',
    project: PROJECT,
    match: { actions: [action] },
    decision: { effect: DECISION_EFFECT.DENY, reason: 'billing history is shared' },
  };
  return new LocalGate([rule], { agentName: 'claude-code' });
}

const projectAt = async (cwd: string): Promise<string | undefined> =>
  cwd.startsWith(BILLING) ? PROJECT : undefined;

function authorizer(action: string, workingDirectory?: string): HookAuthorizer {
  return new HookAuthorizer({
    gate: billingGate(action),
    projectAt,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  });
}

describe('the project a seam names on the request', () => {
  it('is read from the folder a request names, or the seam runs in', async () => {
    const asked = authorizer('deploy.service', ELSEWHERE);
    const inside = await asked.authorize({
      action: 'deploy.service',
      workingDirectory: join(BILLING, 'src'),
    });
    expect(inside.effect).toBe(DECISION_EFFECT.DENY);
    expect((await asked.authorize({ action: 'deploy.service' })).effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
    const inBilling = authorizer('deploy.service', BILLING);
    expect((await inBilling.authorize({ action: 'deploy.service' })).effect).toBe(
      DECISION_EFFECT.DENY,
    );
  });

  it('never replaces a project the request named itself', async () => {
    const asked = authorizer('deploy.service', BILLING);
    const named = await asked.authorize({
      action: 'deploy.service',
      projectId: 'another-project',
    });
    expect(named.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('decides a shell line in the project and not outside it', async () => {
    const line = (cwd: string): ShellSeam =>
      new ShellSeam({ authorizer: authorizer('git.push-force'), workingDirectory: cwd });
    const inside = await line(BILLING).gate(['git push --force']);
    expect(inside.decision.effect).toBe(DECISION_EFFECT.DENY);
    const outside = await line(ELSEWHERE).gate(['git push --force']);
    expect(outside.decision.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it("decides an agent's hooked tool call by the folder the call names", async () => {
    const call = (cwd: string): Parameters<typeof ruleOnTool>[0] => ({
      host: EDIT_HOST.PRE_TOOL_USE,
      tool: 'mcp__railway__deploy',
      sessionId: 'ses_hook',
      cwd,
      requests: [{ action: 'deploy.service', class: TOOL_CLASS.WRITE }],
      nativeAsk: false,
    });
    const deps = {
      authorizer: authorizer('deploy.service'),
      mode: ENFORCEMENT_MODE.ENFORCE,
      env: {},
    };
    expect((await ruleOnTool(call(BILLING), deps)).effect).toBe(DECISION_EFFECT.DENY);
    expect((await ruleOnTool(call(ELSEWHERE), deps)).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('decides a wrapped binary by the project the interceptor read', async () => {
    const gate = billingGate('git.push-force');
    const inside = await ruleOnCommand('git', ['push', '--force'], {
      gate,
      projectId: PROJECT,
    });
    expect(inside.allowed).toBe(false);
    const outside = await ruleOnCommand('git', ['push', '--force'], { gate });
    expect(outside.allowed).toBe(true);
  });

  // The native wrapper is POSIX only, as its own tests are.
  it.skipIf(process.platform === 'win32')(
    'decides the native wrapper by the folder the command runs in',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'memnox-project-fast-'));
      await mkdir(join(configPathFor(home), '..'), { recursive: true });
      await writeFile(configPathFor(home), `mode = "${ENFORCEMENT_MODE.ENFORCE}"\n`);
      const plan = (cwd: string): ReturnType<typeof planIntercept> =>
        planIntercept(
          {
            argv: ['git', 'push', '--force'],
            env: {
              HOME: home,
              PATH: '/usr/bin',
              CLAUDECODE: '1',
              MEMNOX_SESSION: 'ses_fast',
            },
            cwd,
            ppid: 1,
          },
          {
            home,
            ownCwd: home,
            ownEnv: {},
            ancestors: (): string[][] => [],
            exists: (candidate: string): boolean => candidate === '/usr/bin/git',
            gateFor: async (): Promise<LocalGate | null> => billingGate('git.push-force'),
            projectAt: async (_home, cwd) => projectAt(cwd),
            now: (): Date => new Date('2026-10-30T10:00:00.000Z'),
          },
        );
      expect((await plan(BILLING)).kind).toBe(INTERCEPT_PLAN.REFUSE);
      expect((await plan(ELSEWHERE)).kind).not.toBe(INTERCEPT_PLAN.REFUSE);
    },
  );
});
