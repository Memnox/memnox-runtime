import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { minutesToMs, PROPOSAL_KIND, Proposals } from '@memnox/core';
import { OPERATOR_AGENT } from './propose-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import {
  commandResults,
  runMemnox,
  runsInBackground,
  VOICE_RUN,
  voiceCommand,
} from './voice-commands';

/**
 * `memnox_command`: any memnox command, said out loud. What reads runs now and comes back to be
 * summed up; what changes something is proposed and runs once the person touches the sensor.
 */

/** Long enough for a scan or a report, short enough that the person is not left waiting on a hang. */
const READ_TIMEOUT_MS = 30_000;
/** As long as any other proposal, so the Touch ID sheet never confirms something stale. */
const COMMAND_TTL_MS = minutesToMs(5);

const SUM_UP =
  'Sum up what it printed in a sentence or two, in plain words, the answer first. Never read it out, never say a command line, and if it failed, say what the output says went wrong.';

const PROPOSED =
  'Nothing has run. Read back in a sentence what it will do, in plain words, and that it waits for their Touch ID on the Mac. When they say they confirmed, call command_output with this id and sum up what it printed.';

export async function memnoxCommandTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const said = textArg(args, 'command');
  const command = said === undefined ? null : voiceCommand(said);
  if (command === null) {
    return {
      ran: false,
      said: 'That is not a memnox command. Run "help --all" to see them, and say the one that fits.',
    };
  }
  if (command.run === VOICE_RUN.NEVER) return { ran: false, said: command.why };
  if (command.run === VOICE_RUN.NOW) {
    const ran = await (deps.runMemnox ?? runMemnox)(command.argv, READ_TIMEOUT_MS);
    return {
      ran: true,
      command: command.argv.join(' '),
      exitCode: ran.exitCode,
      output: ran.output,
      said: SUM_UP,
    };
  }
  const argv = named(command.argv, deps.machineName ?? computerName);
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.COMMAND, argv },
    rationale: `Run memnox ${argv.join(' ')}`,
    ...(textArg(args, 'said') === undefined ? {} : { said: textArg(args, 'said') ?? '' }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: COMMAND_TTL_MS,
  });
  return {
    proposed: proposal.id,
    command: argv.join(' '),
    said: runsInBackground(argv) ? PROPOSED_ON_ITS_OWN : PROPOSED,
  };
}

/** The name a person gave this Mac in System Settings, else its hostname without `.local`. */
function computerName(): string {
  try {
    const named = execFileSync('scutil', ['--get', 'ComputerName'], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (named !== '') return named;
  } catch {
    // Not a Mac, or scutil refused: the hostname is the next best name.
  }
  return hostname().replace(/\.local$/, '');
}

/** A login with no name enrols as a bare id in the fleet, so it takes the name Enter would have kept. */
function named(argv: readonly string[], machine: () => string): string[] {
  if (argv[0] !== 'login' || argv.includes('--name')) return [...argv];
  return [...argv, '--name', machine()];
}

const PROPOSED_ON_ITS_OWN =
  'Nothing has run. Read back in a sentence what it will do, and that it needs their Touch ID. For login, say that once they touch the sensor a page opens in their browser to approve this Mac, and nothing else is needed; an onboarding needs only the touch. It then runs on its own with no terminal, and you are told when it finishes, so do not ask them to wait or check.';

const STILL_RUNNING =
  'It is still running on its own: a login or an onboarding is waiting for them to approve this Mac in the browser page that opened. Say so in a sentence; they will be told when it is done.';

export async function commandOutputTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const id = textArg(args, 'proposal');
  const result = id === undefined ? null : await commandResults(deps.home).read(id);
  if (result === null) {
    return {
      ran: false,
      said: 'It has not run yet: the Touch ID sheet is still waiting, or they declined. Call waiting to see which.',
    };
  }
  if (result.running === true) return { ran: true, running: true, said: STILL_RUNNING };
  return {
    ran: true,
    command: result.argv.join(' '),
    exitCode: result.exitCode,
    output: result.output,
    said: SUM_UP,
  };
}
