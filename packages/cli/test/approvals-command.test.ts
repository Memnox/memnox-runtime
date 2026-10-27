import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, HOLD_ANSWER, PendingApprovals, type HoldRequest } from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerApprovalsCommand } from '../src/commands/approvals.command';
import { plainStyle } from '../src/style';

const NOW = new Date('2026-10-06T10:00:00.000Z');
const REQUEST: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'hermes',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc12345',
  reason: 'a person approves pushes to main',
};

async function run(home: string, args: string[]): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerApprovalsCommand(program, new CliContext(out, plainStyle), {
    home: () => home,
    now: () => NOW,
    who: () => 'ana',
  });
  await program.parseAsync(args, { from: 'user' });
  return out;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('answering from the terminal', () => {
  it('allows a call for the rest of its session, the same choice every other door offers', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-approve-'));
    const approvals = new PendingApprovals(home);
    const pending = await approvals.raise(REQUEST, NOW.toISOString(), 120_000);

    await run(home, ['approve', pending.id, '--session']);

    expect((await approvals.read(pending.id))?.answer).toBe(HOLD_ANSWER.SESSION);
  });

  it('names where an always answer is made, rather than pretending to make it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-approve-'));

    const out = await run(home, ['approve', 'apr_x', '--always']);

    expect(out.notes.join('\n')).toContain('becomes a team rule');
    expect(process.exitCode).toBe(EXIT.MISUSED);
  });
});
