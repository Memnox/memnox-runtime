/** `memnox run`: starts an agent with the interceptors, the shell wrapper, a session and a milestone in place. */

import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  BROKER_VAR,
  holdCredentials,
  CloudLeases,
  LeaseRegistry,
  pathValueOf,
  prependedPath,
  SESSION_VAR,
  SessionContainments,
  LEDGER_SESSION_LIMIT,
  summarizeSession,
  describeSummary,
  withPathValue,
} from '@memnox/core';
import { FALLBACK_SHELL, interceptorDirFor, REAL_SHELL_VAR } from '@memnox/interceptors';
import type { CliContext } from '../cli-context';
import type { FlowRow } from '../flow';
import { sessionGuardPath } from '../memnox-paths';
import { describeCount } from '../plural';
import { withEvents } from '../event-store';
import { binaryMeantBy, onPath } from '../on-path';
import {
  nowOf,
  prepareRun,
  type PreparedRun,
  type RunDeps,
  type RunOptions,
} from './run/prepare';
import { startBroker, type CredentialBroker } from './run/credential-broker';
import { SESSION_GUARD_EXTENSIONS } from './run/sandbox';
import { defaultStart, interceptorsIn, wiringRow } from './run/start';
import { forgetRunTerminal, noteRunTerminal, ownTerminal } from './run/terminal';

/**
 * Everything the child needs to be governed, set as environment rather than asked of the
 * agent: interceptors first on PATH, SHELL pointing at the wrapper, and a session id.
 */
export function environmentFor(
  base: NodeJS.ProcessEnv,
  home: string,
  sessionId: string,
  shellBinary: string,
): NodeJS.ProcessEnv {
  // Under the spelling the environment already uses, since Windows keeps it as `Path`.
  const path = prependedPath(pathValueOf(base), interceptorDirFor(home));
  return {
    ...withPathValue(base, path),
    SHELL: shellBinary,
    // The displaced shell, so the wrapper hands off to it and never reads `SHELL` to find itself.
    [REAL_SHELL_VAR]: base['SHELL'] ?? FALLBACK_SHELL,
    [SESSION_VAR]: sessionId,
  };
}

export function registerRunCommand(
  program: Command,
  context: CliContext,
  deps: RunDeps = {},
): void {
  program
    .command('run')
    .description('Start an agent with the interceptors, the proxy and a session in place')
    .argument('<command...>', 'the agent command, after --')
    .option('--shell <path>', 'shell the agent should use', 'memnox-shell')
    .option(
      '--transcript',
      'keep a local copy of what the agent printed, so a claim can be checked against the record',
    )
    .option('--no-guard', 'start outside the kernel sandbox even when a profile exists')
    .option('--no-milestone', 'do not keep the working tree before the agent starts')
    .option(
      '--untrusted',
      'a repository nobody here vouched for: writes stay in it, secrets unreadable, the network asks',
    )
    .option('--task <statement>', 'what you actually asked for, in your words')
    .option('--paths <globs>', 'paths the task covers, comma separated')
    .option('--repos <list>', 'repositories the task covers, comma separated')
    .option('--services <list>', 'services the task covers, comma separated')
    .option('--envs <list>', 'environments the task covers, comma separated')
    .option('--expect <count>', 'roughly how many actions this should take')
    .option(
      '--investigate',
      'the task is an investigation: nothing outside this machine changes',
    )
    .option('--role <name>', 'the job this agent is enrolled under, matched by roles:')
    .option('--for <person>', 'the person this agent works for, matched by principals:')
    .option(
      '--brief <id>',
      'a workspace brief the voice gathered, handed to the agent before its first turn',
    )
    .option('--mission <id>', 'join this session to a mission, from memnox mission start')
    .option(
      '--hold-credentials',
      'keep tokens out of the agent environment and hand each only to the CLI that uses it',
    )
    .action(async (command: readonly string[], options: RunOptions) =>
      runAgent(context, deps, command, options),
    );
}

/**
 * Starts the agent with every seam in front of it. The rail is commentary here, because
 * what stdout carries once the agent starts is the agent's own output, teed through.
 */
async function runAgent(
  context: CliContext,
  deps: RunDeps,
  command: readonly string[],
  options: RunOptions,
): Promise<void> {
  context.flow.commentary();
  context.flow.open('memnox run');
  const binary = resolveBinary(command, deps);
  const run = await prepareRun({
    binary,
    command,
    options,
    deps,
    environment: (home, sessionId) =>
      environmentFor(deps.env ?? process.env, home, sessionId, options.shell),
  });
  const broker = options.holdCredentials === true ? await brokerFor(run, deps) : null;
  renderStart(context, run, deps, broker);
  await noteRunTerminal(
    run,
    (deps.cwd ?? process.cwd)(),
    (deps.terminalOf ?? ownTerminal)(),
    nowOf(deps).toISOString(),
  );
  await startAndRelease(context, run, deps, broker);
}

/**
 * The tokens taken out of the environment the agent starts with, held by this process,
 * and the one variable that tells an interceptor where to ask for the ones its binary uses.
 */
async function brokerFor(run: PreparedRun, deps: RunDeps): Promise<CredentialBroker> {
  const { passed, held } = holdCredentials(run.env, run.binary);
  const broker = await (deps.broker ?? startBroker)(run.home, run.sessionId, held);
  for (const name of Object.keys(run.env)) delete run.env[name];
  Object.assign(run.env, passed, { [BROKER_VAR]: broker.path });
  return broker;
}

/** Refused before a session, a milestone or the sandbox, so nothing is kept for a run that never starts. */
function resolveBinary(command: readonly string[], deps: RunDeps): string {
  const binary = command[0];
  if (binary === undefined) {
    throw new Error('Name the command to run:  memnox run -- claude');
  }
  if ((deps.onPath ?? onPath)(binary)) return binary;
  const meant = (deps.binaryMeantBy ?? binaryMeantBy)(binary);
  const hint =
    meant === null
      ? ''
      : `\nThe binary for ${binary} is "${meant}":  memnox run -- ${meant}`;
  throw new Error(`"${binary}" is not on PATH, so there is nothing to start.${hint}`);
}

function renderStart(
  context: CliContext,
  run: PreparedRun,
  deps: RunDeps,
  broker: CredentialBroker | null,
): void {
  const rows: FlowRow[] = [
    { label: 'session', value: run.sessionId },
    wiringRow(context, run.home, deps.interceptorsIn ?? interceptorsIn),
    ...containmentRows(context, run),
    ...(broker === null
      ? []
      : [
          {
            label: 'credentials',
            value: `${describeCount(broker.held, 'variable')} held back, each handed only to the CLI that uses it`,
          },
        ]),
  ];
  rows.push(...askedRows(run));
  if (run.kept !== null) {
    rows.push({
      label: 'working tree',
      value: `kept as ${run.kept}, and "memnox rewind" undoes it`,
    });
  }
  if (run.transcript !== undefined)
    rows.push({ label: 'transcript', value: run.transcript });
  context.flow.rows(`Starting ${run.binary}`, rows);
  context.flow.close(`${run.binary} is running under session ${run.sessionId}.`);
  if (run.hint !== null) context.flow.hint(run.hint);
}

/** What the session is here to do: the mission it is one run of, and its own task. */
function askedRows(run: PreparedRun): FlowRow[] {
  const rows: FlowRow[] = [];
  if (run.mission !== null) {
    rows.push({
      label: 'mission',
      value: `"${run.mission.statement}", session ${run.mission.sessions.length}`,
    });
  }
  if (run.declared === null) return rows;
  rows.push({ label: 'task', value: `"${run.declared.statement}"` });
  if (run.declared.expectedActions !== undefined) {
    rows.push({
      label: 'expecting',
      value: `about ${run.declared.expectedActions} actions`,
    });
  }
  return rows;
}

/** The wall and the network, said as they are, including where there is neither. */
function containmentRows(context: CliContext, run: PreparedRun): FlowRow[] {
  const { style } = context;
  const sandbox = run.sandbox;
  const rows: FlowRow[] = [
    {
      label: 'sandbox',
      value:
        sandbox.guard === null ? sandbox.because : `${sandbox.guard}: ${sandbox.because}`,
    },
    {
      label: 'network',
      value:
        run.egress === null
          ? style.warn('not proxied, since no egress proxy would start')
          : `through the ${run.egress.source} egress proxy on port ${run.egress.port}, ruled on by host`,
    },
  ];
  if (run.untrusted) {
    rows.push({
      label: 'untrusted',
      value:
        'writes stay in the repository and temp; outward and destructive actions ask',
    });
  }
  return rows;
}

async function startAndRelease(
  context: CliContext,
  run: PreparedRun,
  deps: RunDeps,
  broker: CredentialBroker | null,
): Promise<void> {
  const start = deps.start ?? defaultStart;
  const [executable, ...args] = run.sandbox.command;
  try {
    process.exitCode = await start(
      executable ?? run.binary,
      args,
      run.env,
      run.transcript,
    );
  } finally {
    // In a `finally`, because an agent that crashed is the one whose paths must not stay held.
    const released = await releaseLeases(run.home, run.sessionId, deps);
    await endContainment(run);
    await forgetRunTerminal(run);
    // The held values die with this process; closing removes the socket that served them.
    await broker?.close().catch(() => undefined);
    // Off the rail, because it closed when the agent took over the terminal.
    const said = [
      released > 0 ? `released ${describeCount(released, 'lease')}` : null,
      await summaryOf(run),
    ].filter((line): line is string => line !== null);
    if (said.length > 0) context.out.note(said.join('\n'));
  }
}

/** What the session did, in one line, so nobody has to ask for it. Null when nothing was kept. */
async function summaryOf(run: PreparedRun): Promise<string | null> {
  try {
    const events = await withEvents(run.home, (store) =>
      store.query({ sessionId: run.sessionId, limit: LEDGER_SESSION_LIMIT }),
    );
    const summary = summarizeSession(events);
    return summary === null ? null : describeSummary(summary);
  } catch {
    // A ledger that will not open is no reason to make an agent's exit fail.
    return null;
  }
}

/** Quiet on failure: a register that cannot be written must not stop an agent exiting. */
async function releaseLeases(
  home: string,
  sessionId: string,
  deps: RunDeps,
): Promise<number> {
  try {
    const registry = new LeaseRegistry(home);
    const released = await registry.releaseSession(sessionId, nowOf(deps).toISOString());
    // Once per agent in the workspace too, or another machine waits on paths nobody writes.
    const shared = new CloudLeases(home);
    const agents = new Set(released.map((lease) => lease.holder.agent));
    for (const agent of agents) {
      await shared.releaseSession({ agent, sessionId, pid: process.pid });
    }
    return released.length;
  } catch {
    return 0;
  }
}

/** The session's proxy closed and its record gone, so nothing outlives the agent it was for. */
async function endContainment(run: PreparedRun): Promise<void> {
  await run.egress?.close().catch(() => undefined);
  await new SessionContainments(run.home).clear(run.sessionId).catch(() => undefined);
  for (const extension of SESSION_GUARD_EXTENSIONS) {
    await rm(sessionGuardPath(run.home, run.sessionId, extension), { force: true }).catch(
      () => undefined,
    );
  }
}
