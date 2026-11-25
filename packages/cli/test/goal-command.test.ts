import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { commandTree } from '../src/help';
import { registerMissionCommand } from '../src/commands/mission.command';
import { buildProgram } from '../src/program';
import { plainStyle } from '../src/style';

/**
 * The person gives their agents a goal and Memnox only keeps it and follows the work, so the
 * command says goal. `mission` is the old name, still answered and never shown.
 */

/** The word on its own, since permission holds it too. */
const MISSION = /\bmissions?\b/i;

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function helpFor(args: string[]): Promise<string> {
  const program = buildProgram(new CliContext(new RecordedOutput(), plainStyle));
  let written = '';
  program.configureOutput({
    writeOut: (text) => {
      written += text;
    },
  });
  program.exitOverride();
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch {
    // `--help` exits through the override once it has written, which is the run under test.
  }
  return written;
}

async function goalsIn(args: string[], home: string): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command().exitOverride();
  registerMissionCommand(program, new CliContext(out, plainStyle), () => home);
  await program.parseAsync(args, { from: 'user' });
  return out;
}

describe('memnox goal', () => {
  it('never says mission in its help, its subcommands or the voice catalogue', async () => {
    for (const args of [
      ['goal', '--help'],
      ['goal', 'start', '--help'],
      ['help', '--all'],
      ['help', '--tree'],
      ['run', '--help'],
    ]) {
      expect(await helpFor(args)).not.toMatch(MISSION);
    }
    const program = buildProgram(new CliContext(new RecordedOutput(), plainStyle));
    expect(commandTree(program).join('\n')).not.toMatch(MISSION);
    expect(await helpFor(['run', '--help'])).toContain('--goal <id>');
  });

  it('answers to goal and to the old mission alike', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-goal-'));
    homes.push(home);
    await goalsIn(['goal', 'start', 'Fix the payment webhook', '--repo', home], home);

    const byGoal = JSON.parse((await goalsIn(['goal', 'list', '--json'], home)).text);
    const byMission = JSON.parse(
      (await goalsIn(['mission', 'list', '--json'], home)).text,
    );

    expect(byGoal).toHaveLength(1);
    expect(byMission).toEqual(byGoal);
  });
});
