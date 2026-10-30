import { DECISION_EFFECT, LocalGate, ViolationMemory, DAEMON_METHOD } from '@memnox/core';
import { describe, expect, it } from 'vitest';
import { projectOfRequest, ruleVerdictFor } from '../src/daemon/rule-verdict';
import { dryRun } from '../src/policy-requests';

const PROJECT = 'billing';
const REPO = '/work/billing';

function projectGate(action = 'deploy'): LocalGate {
  return new LocalGate(
    [
      {
        name: 'billing-no-deploy',
        project: PROJECT,
        match: { actions: [action] },
        decision: { effect: DECISION_EFFECT.DENY, reason: 'billing ships on Tuesdays' },
      },
    ],
    { agentName: 'agent' },
  );
}

const request = {
  id: 1,
  method: DAEMON_METHOD.EVALUATE,
  action: 'deploy',
  workingDirectory: REPO,
};

async function verdictIn(
  lookup: (cwd: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const projectId = await projectOfRequest(request, lookup);
  return ruleVerdictFor({
    gate: projectGate(),
    violations: new ViolationMemory(),
    request,
    action: 'deploy',
    now: '2026-10-30T00:00:00.000Z',
    ...(projectId === undefined ? {} : { projectId }),
  }).effect;
}

describe("the daemon's evaluate in a project", () => {
  it("rules on a call in the project's folder with the project's rules", async () => {
    expect(await verdictIn(async (cwd) => (cwd === REPO ? PROJECT : undefined))).toBe(
      DECISION_EFFECT.DENY,
    );
  });

  it('falls back to the machine rules when the folder cannot be placed', async () => {
    expect(
      await verdictIn(async () => {
        throw new Error('git is gone');
      }),
    ).toBe(DECISION_EFFECT.ALLOW);
  });

  it('never takes a project from the client, only from the folder', async () => {
    const claimed = { ...request, workingDirectory: undefined, projectId: PROJECT };
    expect(await projectOfRequest(claimed, async () => PROJECT)).toBeUndefined();
  });
});

describe('a dry run in a project', () => {
  it('answers with the project rules once it is told the project, as enforcement does', () => {
    const gate = projectGate('git.push');
    const inProject = dryRun(gate, 'git.push', { projectId: PROJECT }, {});
    const outside = dryRun(gate, 'git.push', {}, {});
    expect(inProject.verdict.effect).toBe(DECISION_EFFECT.DENY);
    expect(outside.verdict.effect).toBe(DECISION_EFFECT.ALLOW);
  });
});
