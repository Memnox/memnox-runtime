import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerStatusCommand } from '../src/commands/status.command';
import { plainStyle } from '../src/style';

/** A version the team withdrew with `npm deprecate` is the first thing memnox status says, for anyone with no app. */

const SET_UP = {
  setUp: true,
  mode: 'enforce',
  daemon: 'keeping',
  agents: 1,
  hooked: [],
  unhooked: [],
  mcpServers: 0,
  mcpWrapped: 0,
  rules: 0,
  today: { actions: 0, asked: 0, denied: 0 },
  waiting: 0,
  paused: 0,
  workspace: null,
  dormant: [],
} as const;

async function status(
  withdrawn: (version: string) => Promise<string | null>,
  args = ['status'],
): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerStatusCommand(program, new CliContext(out, plainStyle), {
    home: () => '/nowhere',
    project: () => '/nowhere',
    read: async () => ({ ...SET_UP, hooked: [], unhooked: [], dormant: [] }),
    ahead: async () => ({ working: [] }),
    installed: () => '0.15.1',
    withdrawn,
  });
  await program.parseAsync(args, { from: 'user' });
  return out;
}

describe('memnox status on a withdrawn version', () => {
  it('says first that it was withdrawn, why, and how to move off it', async () => {
    const out = await status(async (version) =>
      version === '0.15.1' ? 'signature check fault, fixed in 0.15.2' : null,
    );

    const said = out.text.indexOf(
      'Memnox 0.15.1 was withdrawn for a fault: signature check fault, fixed in 0.15.2',
    );
    expect(said).toBeGreaterThan(-1);
    expect(said).toBeLessThan(out.text.indexOf('Memnox is keeping this machine.'));
    expect(out.text).toContain('memnox update');
  });

  it('says nothing of it for a version that stands, or when npm cannot be asked', async () => {
    expect((await status(async () => null)).text).not.toContain('withdrawn');
    expect(
      (await status(async () => Promise.reject(new Error('offline')))).text,
    ).not.toContain('withdrawn');
  });

  it('puts it in the JSON too, for a script that watches status', async () => {
    const out = await status(async () => 'fault', ['status', '--json']);

    expect(out.text).toContain('"withdrawn"');
    expect(out.text).toContain('"reason": "fault"');
  });
});
