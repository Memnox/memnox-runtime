import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { RunTerminals, SessionHosts } from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerResumeCommand } from '../src/commands/resume.command';

const NOW = new Date('2026-11-11T12:00:00.000Z');
/** A pid no process has, so the run reads as cut off. */
const GONE_PID = 2 ** 22 + 17;

async function cutOff(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-resume-cut-'));
  await new RunTerminals(home).note({
    sessionId: 'ses_cut',
    agent: 'claude-code',
    pid: GONE_PID,
    cwd: '/work/billing',
    startedAt: '2026-11-11T09:00:00.000Z',
    command: ['claude'],
    relaunch: ['--task', 'fix the invoice rounding', '--role', 'billing'],
  });
  await new SessionHosts(home).note({
    sessionId: 'ses_cut',
    agent: 'claude-code',
    pid: GONE_PID,
    agentSession: 'conv-42',
    seenAt: '2026-11-11T09:00:05.000Z',
  });
  return home;
}

async function resume(
  home: string,
  yes: boolean,
): Promise<{ out: RecordedOutput; started: { argv: readonly string[]; cwd: string }[] }> {
  const out = new RecordedOutput();
  const started: { argv: readonly string[]; cwd: string }[] = [];
  const program = new Command();
  registerResumeCommand(program, new CliContext(out, plainStyle), {
    home: () => home,
    now: () => NOW,
    confirm: async () => yes,
    relaunch: (argv, cwd) => {
      started.push({ argv, cwd });
      return 0;
    },
  });
  await program.parseAsync(['resume', 'ses_cut', '--by', 'dana'], { from: 'user' });
  return { out, started };
}

describe('memnox resume, on a run a crash cut off', () => {
  it('starts it again with its task and role, picking up its own conversation', async () => {
    const { started, out } = await resume(await cutOff(), true);

    expect(started).toEqual([
      {
        argv: [
          'run',
          '--task',
          'fix the invoice rounding',
          '--role',
          'billing',
          '--',
          'claude',
          '--resume',
          'conv-42',
        ],
        cwd: '/work/billing',
      },
    ]);
    expect(out.text).toContain('its own conversation');
  });

  it('starts nothing when the person says no, and keeps it listed', async () => {
    const home = await cutOff();
    const { started } = await resume(home, false);

    expect(started).toEqual([]);
    expect(await new RunTerminals(home).read('ses_cut')).not.toBeNull();
  });
});
