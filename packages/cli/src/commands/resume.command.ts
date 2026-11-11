import { spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';

import type { Command } from 'commander';

import {
  clearSessionTaint,
  relaunchOf,
  RunTerminals,
  SessionPauses,
  type InterruptedRun,
  type SessionPause,
  type Taint,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import { confirmOnTerminal, type Confirm } from '../confirm';
import { readInterrupted } from '../session-tools/session-board-read';
import { describeCount } from '../plural';
import { TONE } from '../flow';

/**
 * `memnox paused` and `memnox resume`: lifting a hold, because a stop nobody can undo is
 * one people work around by uninstalling. Who lifted it stays in the record.
 */

/** What both subcommands need. */
interface ResumeDeps {
  context: CliContext;
  home: () => string;
  now: () => Date;
  /** Asked before a cut off run is started again, since starting an agent is the person's call. */
  confirm: Confirm;
  /** Starts `memnox` with these arguments in this terminal, and waits for it to end. */
  relaunch: (argv: readonly string[], cwd: string) => number;
}

export function registerResumeCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<Omit<ResumeDeps, 'context'>> = {},
): void {
  const deps: ResumeDeps = {
    context,
    home: homedir,
    now: () => new Date(),
    confirm: confirmOnTerminal,
    relaunch: relaunchHere,
    ...overrides,
  };
  program
    .command('paused')
    .description('Sessions Memnox is holding, and why')
    .action(async () => runPaused(deps));

  program
    .command('resume <session>')
    .description('Let a paused session carry on, or start one a crash cut off again')
    .option('--by <who>', 'who is lifting it', userInfo().username)
    .action(async (session: string, options: ResumeOptions) =>
      runResume(deps, session, options),
    );
}

/** Every session being held right now, and the signal that stopped each. */
async function runPaused(deps: ResumeDeps): Promise<void> {
  const { context, home } = deps;
  const { flow } = context;
  flow.open('memnox paused');

  const held = (await new SessionPauses(home()).all()).filter(
    (pause) => pause.resumedAt === undefined,
  );
  if (held.length === 0) {
    flow.close('Nothing is paused.');
    return;
  }
  flow.list(
    'Held',
    held.map((pause) => ({
      tone: TONE.WARN,
      text: `${pause.sessionId}  ${pause.signal}`,
      detail: [
        pause.reason,
        pause.lastAction === undefined ? undefined : `last: ${pause.lastAction}`,
      ],
    })),
  );
  flow.close(
    `${describeCount(held.length, 'session')} ${held.length === 1 ? 'is' : 'are'} held.`,
  );
  flow.hint('Lift one with "memnox resume <session> --by <you>".');
}

interface ResumeOptions {
  by: string;
}

/** Lifts one hold, keeping who lifted it and what it was held for on the record. */
async function runResume(
  deps: ResumeDeps,
  session: string,
  options: ResumeOptions,
): Promise<void> {
  const { context, home, now } = deps;
  const { flow, style } = context;
  flow.open('memnox resume');

  const pauses = new SessionPauses(home());
  const resumed = await pauses.resume(session, options.by, now().toISOString());
  // A person saying carry on also lifts the wariness a suspicious tool result left.
  const clearing = { sessionId: session, by: options.by, now };
  const untainted = await clearSessionTaint(home(), clearing);
  if (resumed === null && untainted === null) {
    const cut = (await readInterrupted(home())).find((run) => run.sessionId === session);
    if (cut !== undefined) return startAgain(deps, cut);
    throw new Error(
      `${session} is not paused, was not cut off, and nothing has it under suspicion.`,
    );
  }

  flow.rows('Resumed', [
    { label: 'session', value: session },
    { label: 'by', value: options.by },
    ...liftedRows(resumed, untainted),
  ]);
  flow.close(style.ok(`${session} carries on.`));
  flow.hint('The next command in that session runs; nothing needs restarting.');
}

/** What stopped it is still true, and saying so is lifting a hold rather than forgetting one. */
function liftedRows(
  resumed: SessionPause | null,
  untainted: Taint | null,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (resumed !== null)
    rows.push({ label: 'was held', value: `because ${resumed.reason}` });
  if (untainted !== null) {
    rows.push({
      label: 'was wary',
      value: `because ${untainted.source} read like instructions`,
    });
  }
  return rows;
}

/** A run a crash or reboot cut off, started again with what shaped it, once the person says so. */
async function startAgain(deps: ResumeDeps, cut: InterruptedRun): Promise<void> {
  const { context, home } = deps;
  const { flow } = context;
  const { argv, resumes } = relaunchOf(cut);
  flow.rows('Cut off', [
    { label: 'agent', value: cut.agent },
    { label: 'in', value: cut.cwd },
    { label: 'started', value: cut.startedAt },
    {
      label: 'picks up',
      value: resumes ? 'its own conversation' : 'nothing; it starts fresh',
    },
  ]);
  const yes = await deps.confirm(
    `Start it again with "memnox ${argv.join(' ')}"?`,
    false,
  );
  if (!yes) {
    flow.close('Left as it was.');
    return;
  }
  // Forgotten first, so the old record never lists beside the run that replaces it.
  await new RunTerminals(home()).forget(cut.sessionId);
  flow.close(`Starting ${cut.agent} again.`);
  process.exitCode = deps.relaunch(argv, cut.cwd);
}

/** This same `memnox`, in this terminal, so the agent takes the tab exactly as before. */
function relaunchHere(argv: readonly string[], cwd: string): number {
  const entry = process.argv[1];
  if (entry === undefined) throw new Error('Cannot find the memnox that is running.');
  const result = spawnSync(process.execPath, [entry, ...argv], { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}
