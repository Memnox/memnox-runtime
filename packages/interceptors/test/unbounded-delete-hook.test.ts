import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ROUTE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  HOLD_ANSWER,
  LocalGate,
  PendingApprovals,
  policiesFrom,
  recommendedAnswers,
} from '@memnox/core';
import { HookAuthorizer } from '../src/hook-authorizer';
import { answerToolCall } from '../src/tool-hook';

/* Claude Code reaches for every order, Memnox holds it, a person says no from their phone with
   a reason, and the agent is told why and what to run instead, then narrows the statement. */

const NOW = new Date('2026-10-23T10:00:00.000Z');
const home = () => mkdtemp(join(tmpdir(), 'memnox-unbounded-'));

function bash(command: string): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    cwd: '/repo',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

async function run(machine: string, command: string) {
  const gate = new LocalGate(policiesFrom(recommendedAnswers()), {
    agentName: 'claude-code',
  });
  return answerToolCall(
    bash(command),
    {
      home: machine,
      agent: 'claude-code',
      runSession: undefined,
      env: {},
      personThere: false,
      now: () => NOW,
    },
    {
      authorizer: new HookAuthorizer({ gate }),
      mode: ENFORCEMENT_MODE.ENFORCE,
      sink: null,
      route: APPROVAL_ROUTE.BOTH,
    },
  );
}

describe('an unbounded delete under the baseline', () => {
  it('is held, then refused with the person’s reason and the bounded way forward', async () => {
    const machine = await home();
    const everyOrder = 'psql -c "DELETE FROM orders"';

    const first = await run(machine, everyOrder);
    expect(first?.ruling.effect).toBe(DECISION_EFFECT.ASK);

    const approvals = new PendingApprovals(machine);
    const [held] = await approvals.list(NOW.toISOString());
    expect(held?.request.alternative).toContain('on orders');
    await approvals.answer(
      held?.id ?? '',
      HOLD_ANSWER.DENY,
      'Moise (the workspace)',
      NOW.toISOString(),
      'only the test orders',
    );

    const retry = await run(machine, everyOrder);
    expect(retry?.ruling.effect).toBe(DECISION_EFFECT.DENY);
    const told = retry?.reply?.stdout ?? '';
    expect(told).toContain('said no to this');
    expect(told).toContain('and said: only the test orders');
    expect(told).toContain('Instead:');
    expect(told).toContain('add a WHERE to the DELETE on orders');
  });

  it('lets the same delete through once it is bounded to the test orders', async () => {
    const bounded = await run(
      await home(),
      `psql -c "DELETE FROM orders WHERE email LIKE '%@test.example'"`,
    );
    expect(bounded?.ruling.effect).toBe(DECISION_EFFECT.ALLOW);
  });
});
