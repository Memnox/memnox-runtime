/**
 * `memnox pair`: puts a pairing QR on this terminal, so a phone or a Mac can reach a machine
 * with no Memnox app of its own, such as a server over SSH. The person at the shell accepts by
 * typing the six digits the device shows, which only its screen holds.
 */

import { homedir, hostname } from 'node:os';
import type { Command } from 'commander';
import {
  DAEMON_METHOD,
  DEVICE_KIND,
  encodeQr,
  EXIT,
  PAIR_APPROVER,
  PAIRING_STATE,
  REMOTE_OUTCOME,
  SESSION_VAR,
  type PairingWire,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import { socketDial, type DaemonDial } from '../remote/daemon-dial';
import { qrLines } from '../remote/qr-text';

/** Asks the person for a line and gives it back, or null when they closed the terminal. */
type AskLine = (question: string) => Promise<string | null>;

interface PairDeps {
  home: () => string;
  dial: (home: string) => DaemonDial;
  askLine: AskLine;
  env: NodeJS.ProcessEnv;
  interactive: () => boolean;
  machineName: () => string;
}

/** One run: who is asked, where the daemon is, and what this machine is called on the device. */
interface PairRun {
  context: CliContext;
  deps: PairDeps;
  dial: DaemonDial;
  name: string;
}

const NO_DAEMON =
  'The Memnox daemon is not answering here. Start it with memnox daemon --install, then pair again.';

export function registerPairCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<PairDeps> = {},
): void {
  const deps: PairDeps = {
    home: homedir,
    dial: socketDial,
    askLine: askOnTerminal,
    env: process.env,
    interactive: () => process.stdin.isTTY === true,
    machineName: hostname,
    ...overrides,
  };
  program
    .command('pair')
    .description('Pair a phone or a Mac, so it can answer and talk to the agents here')
    .option('--name <name>', 'what the device should call this machine')
    .action(async (options: { name?: string }) => {
      context.flow.open('pair');
      const name = options.name?.trim() || deps.machineName();
      const run = { context, deps, dial: deps.dial(deps.home()), name };
      process.exitCode = await runPair(run);
      context.flow.end();
    });
}

async function runPair(run: PairRun): Promise<number> {
  const blocked = await whyNot(run);
  if (blocked !== null) return failed(run, blocked);
  const begun = await run.dial.ask({
    id: 2,
    method: DAEMON_METHOD.PAIR_BEGIN,
    name: run.name,
  });
  const pairing = begun?.pairing;
  if (begun === null || !begun.ok || pairing?.qr === undefined) {
    return failed(run, begun?.reason ?? NO_DAEMON);
  }
  if (pairing.approver !== PAIR_APPROVER.LOCAL_SHELL) {
    await run.dial.ask({
      id: 3,
      method: DAEMON_METHOD.PAIR_DECLINE,
      pairingId: pairing.id,
    });
    return failed(
      run,
      'This machine approves pairings with Touch ID, in the Memnox app.',
    );
  }
  showQr(run, pairing.qr, pairing.expiresAt);
  const reached = await answeredOrOver(run.dial, pairing.id);
  if (reached?.state !== PAIRING_STATE.ANSWERED || reached.phone === undefined) {
    return failed(run, endedWith(reached?.state));
  }
  run.context.flow.step(`${reached.phone.name} reached ${run.name}`);
  return acceptWithDigits(run, pairing.id);
}

/** Why pairing cannot start here, or null when it can. */
async function whyNot(run: PairRun): Promise<string | null> {
  // An agent with a shell could otherwise pair a device somebody else holds and answer for the person.
  if (run.deps.env[SESSION_VAR] !== undefined || !run.deps.interactive()) {
    return 'memnox pair asks for the digits a device shows, so it runs in your own terminal and never under an agent.';
  }
  const listed = await run.dial.ask({ id: 1, method: DAEMON_METHOD.DEVICES_LIST });
  if (listed === null) return NO_DAEMON;
  return listed.devices?.some((each) => each.kind === DEVICE_KIND.MAC) === true
    ? 'This Mac approves pairings with Touch ID, so pair from the Memnox app in the menu bar.'
    : null;
}

function showQr(run: PairRun, link: string, until?: string): void {
  const flow = run.context.flow;
  flow.step(`Pairing ${run.name}`, 'On your iPhone, open Memnox and scan this code.');
  const code = encodeQr(link);
  if (code !== null) for (const line of qrLines(code)) flow.aside(line);
  flow.value('On a Mac, choose Connect to a server in Memnox and paste this link', link);
  const ends =
    until === undefined ? '' : ` It works until ${new Date(until).toLocaleTimeString()}.`;
  flow.aside(`Waiting for a device to scan it.${ends}`);
}

/** The pairing once a device answered it, or once it ended without one. */
function answeredOrOver(
  dial: DaemonDial,
  pairingId: string,
): Promise<PairingWire | null> {
  return new Promise((resolve) => {
    let stop = (): void => undefined;
    let done = false;
    const finish = (value: PairingWire | null): void => {
      if (done) return;
      done = true;
      stop();
      resolve(value);
    };
    stop = dial.follow(
      { id: 4, method: DAEMON_METHOD.PAIR_PENDING, pairingId },
      (response) => {
        const state = response.pairing?.state;
        if (!response.ok) finish(null);
        else if (state !== undefined && state !== PAIRING_STATE.WAITING)
          finish(response.pairing ?? null);
      },
      () => finish(null),
    );
  });
}

/** Asked until the digits match, the daemon closes the pairing, or the person walks away. */
async function acceptWithDigits(run: PairRun, pairingId: string): Promise<number> {
  const flow = run.context.flow;
  for (let id = 10; ; id++) {
    const asked = await run.deps.askLine(
      `${flow.prompt}The six digits the device shows: `,
    );
    const typed = asked?.trim() ?? '';
    if (typed === '') {
      await run.dial.ask({ id, method: DAEMON_METHOD.PAIR_DECLINE, pairingId });
      return failed(run, 'Nothing was typed, so the device was not paired.');
    }
    const accepted = await run.dial.ask({
      id,
      method: DAEMON_METHOD.PAIR_ACCEPT,
      pairingId,
      code: typed,
    });
    if (accepted === null) return failed(run, NO_DAEMON);
    if (accepted.outcome === REMOTE_OUTCOME.PAIRED) {
      const who = accepted.device?.name ?? 'the device';
      flow.close(
        `Paired ${who}. It sees the agents here, answers them and talks to them.`,
      );
      flow.hint('memnox devices   lists every device, and revoke takes one away');
      return EXIT.OK;
    }
    const reason = accepted.reason ?? 'The device was not paired.';
    if ((accepted.triesLeft ?? 0) === 0) return failed(run, reason);
    flow.aside(reason);
  }
}

function failed(run: PairRun, reason: string): number {
  run.context.flow.fail(reason);
  return EXIT.FAILED;
}

function endedWith(state: string | undefined): string {
  if (state === PAIRING_STATE.EXPIRED)
    return 'No device scanned the code in time. Run memnox pair again.';
  if (state === PAIRING_STATE.DECLINED) return 'The pairing was declined.';
  return 'The daemon stopped answering before a device scanned the code.';
}

async function askOnTerminal(question: string): Promise<string | null> {
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question(question);
  } catch {
    // Ctrl+D, or a stdin that closed: neither is a code.
    return null;
  } finally {
    prompt.close();
  }
}
