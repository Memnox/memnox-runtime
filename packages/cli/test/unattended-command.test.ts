import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import type { UnattendedInput } from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerUnattendedCommand } from '../src/commands/unattended.command';

const FACTS: UnattendedInput = {
  agent: 'claude-code',
  enforcing: true,
  radius: {
    credentials: [],
    automatic: 12,
    needsApproval: 4,
    never: 3,
    ungoverned: 2,
    destructiveAutomatic: false,
  },
  waiting: 0,
  paused: 0,
  spentBudgets: [],
};

async function run(facts: UnattendedInput, args: string[]): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerUnattendedCommand(program, new CliContext(out, plainStyle), {
    home: () => '/nowhere',
    project: () => '/nowhere',
    read: async (_home, _project, agent) => ({ ...facts, agent }),
  });
  await program.parseAsync(['unattended', ...args], { from: 'user' });
  return out;
}

describe('memnox unattended', () => {
  it('says the agent can be left when nothing needs a person', async () => {
    const out = await run(FACTS, []);
    expect(out.text).toContain('You can leave claude-code running.');
  });

  it('names what to settle first, for the agent asked about', async () => {
    const out = await run({ ...FACTS, waiting: 1 }, ['--agent', 'cursor']);
    expect(out.text).toContain('1 call is waiting on you');
    expect(out.text).toContain('before cursor is left alone');
  });

  it('answers in JSON for the voice and anything else that reads it', async () => {
    const out = await run({ ...FACTS, enforcing: false }, ['--json']);
    expect(out.text).toContain('"canLeave": false');
  });
});
