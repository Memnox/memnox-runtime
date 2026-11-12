import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  HOLD_ANSWER,
  HoldService,
  LeaseGate,
  LeaseRegistry,
  type ActionRequest,
  type HoldAnswer,
  type HoldRequest,
  type LeaseHolder,
} from '@memnox/core';
import type { HookAuthorizer } from '../src/hook-authorizer';
import { ShellSeam, SHELL_EXIT_OK, SHELL_EXIT_WITHHELD } from '../src/shell-seam';

const ROOT = '/work/repo';
const NOW = '2026-11-11T10:00:00.000Z';
// Alive, so the other agent's lease is in force when the seam reads the register itself.
const cursor: LeaseHolder = {
  agent: 'cursor',
  sessionId: 'ses_cursor',
  pid: process.pid,
};
const claude: LeaseHolder = { agent: 'claude-code', sessionId: 'ses_claude', pid: 222 };

const allowing = {
  async authorize(_request: ActionRequest) {
    return { effect: DECISION_EFFECT.ALLOW, reason: 'no rule matched' };
  },
  personAllowed() {
    return undefined;
  },
} as unknown as HookAuthorizer;

async function seam(
  staged: string[],
  answer: (request: HoldRequest) => HoldAnswer,
): Promise<{ gate: ShellSeam; asked: HoldRequest[] }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-shared-commit-'));
  const registry = new LeaseRegistry(home, () => true);
  await registry.take(
    { path: 'src/billing', holder: cursor, minutes: 60, activity: 'fixing rounding' },
    NOW,
  );
  const asked: HoldRequest[] = [];
  const hold = new HoldService({
    ask: async (request) => {
      asked.push(request);
      return { answer: answer(request) };
    },
  });
  const gate = new ShellSeam({
    authorizer: allowing,
    home,
    hold,
    workingDirectory: ROOT,
    now: () => new Date(NOW),
    stagedFiles: () => staged,
    leases: {
      gate: new LeaseGate({ registry, now: () => NOW, sleep: async () => undefined }),
      holder: claude,
      repositoryRoot: ROOT,
      isDirectory: (path) => !path.includes('.'),
    },
  });
  return { gate, asked };
}

describe('a commit that would take another agent unfinished work', () => {
  it('asks first, naming the other agent and its files', async () => {
    const { gate, asked } = await seam(
      ['src/billing/invoice.ts', 'README.md'],
      () => HOLD_ANSWER.DENY,
    );
    const outcome = await gate.gate(['git commit -am "fix"']);

    expect(outcome.exitCode).toBe(SHELL_EXIT_WITHHELD);
    expect(asked[0]?.reason).toBe(
      'cursor (ses_cursor) is still changing src/billing/invoice.ts, which this commit would take with it.',
    );
  });

  it('commits both once the person says yes', async () => {
    const { gate } = await seam(['src/billing/invoice.ts'], () => HOLD_ANSWER.ONCE);
    expect((await gate.gate(['git commit -m "fix"'])).exitCode).toBe(SHELL_EXIT_OK);
  });

  it('asks nothing when only its own files are staged', async () => {
    const { gate, asked } = await seam(['README.md'], () => HOLD_ANSWER.DENY);
    expect((await gate.gate(['git commit -m "docs"'])).exitCode).toBe(SHELL_EXIT_OK);
    expect(asked).toEqual([]);
  });
});
