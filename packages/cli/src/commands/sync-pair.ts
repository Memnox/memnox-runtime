import type { Command } from 'commander';
import {
  DAEMON_METHOD,
  EXIT,
  readAccount,
  type DaemonResponse,
  type PersonalSyncMachine,
  type PersonalSyncStatus,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import type { DaemonDial } from '../remote/daemon-dial';

/**
 * `memnox sync pair`: moves the personal sync key to another of the person's machines from a
 * terminal. It shows the fingerprint both machines show and raises the same proposal the daemon
 * methods raise, which the person signs in the Memnox app; nothing here moves the key itself.
 */

interface SyncPairDeps {
  home: () => string;
  dial: (home: string) => DaemonDial;
}

interface PairOptions {
  fingerprint?: string;
}

interface PairRun {
  context: CliContext;
  dial: DaemonDial;
  home: string;
  machine?: string;
  fingerprint?: string;
}

const NO_DAEMON =
  'The Memnox daemon is not answering here. Start it with memnox daemon --install, then pair again.';
const SIGN_IT = 'Sign it in the Memnox app on this machine, and the key moves.';

export function registerSyncPair(
  sync: Command,
  context: CliContext,
  deps: SyncPairDeps,
): void {
  sync
    .command('pair [machine]')
    .description(
      'Give your personal sync key to another of your machines, or take it here, behind the fingerprint both show',
    )
    .option('--fingerprint <fingerprint>', 'what both machines show, once compared')
    .action(async (machine: string | undefined, options: PairOptions) => {
      context.flow.open('memnox sync pair');
      const home = deps.home();
      const run: PairRun = {
        context,
        dial: deps.dial(home),
        home,
        ...(machine === undefined ? {} : { machine }),
        ...(options.fingerprint === undefined
          ? {}
          : { fingerprint: options.fingerprint }),
      };
      process.exitCode = await runPair(run);
      context.flow.end();
    });
}

async function runPair(run: PairRun): Promise<number> {
  // A sync first registers this machine, so the one holding the key can see it waiting.
  const synced = await run.dial.ask({ id: 1, method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
  if (synced === null) return failed(run, NO_DAEMON);
  const status = synced.personalSync;
  if (!synced.ok || status === undefined)
    return failed(run, synced.reason ?? 'Personal sync did not answer.');
  if (status.keyId !== undefined) return offer(run, status);
  if (status.arrivedFingerprint !== undefined)
    return accept(run, status.arrivedFingerprint);
  return waiting(run, status);
}

/** On the machine holding the key: the machines waiting, or the proposal to seal it to one. */
async function offer(run: PairRun, status: PersonalSyncStatus): Promise<number> {
  if (status.waiting.length === 0 || run.machine === undefined)
    return listWaiting(run, status.waiting);
  const machine = status.waiting.find((each) => each.machineId === run.machine);
  if (machine === undefined)
    return failed(run, `${run.machine} is not one of your machines waiting for the key.`);
  if (run.fingerprint === undefined)
    return compareFirst(
      run,
      machine.fingerprint,
      `memnox sync pair ${machine.machineId}`,
    );
  return proposed(
    run,
    await run.dial.ask({
      id: 2,
      method: DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER,
      syncMachineId: machine.machineId,
      syncFingerprint: run.fingerprint,
    }),
    `Proposed giving your sync key to ${machine.machineId}.`,
  );
}

function listWaiting(run: PairRun, waiting: readonly PersonalSyncMachine[]): number {
  const { flow } = run.context;
  if (waiting.length === 0) {
    flow.close('No other machine of yours is waiting for the key.');
    flow.hint('Run memnox sync pair on the new machine first, then here again.');
    return EXIT.OK;
  }
  flow.rows(
    'Waiting for your sync key',
    waiting.map((each) => ({ label: each.machineId, value: each.fingerprint })),
  );
  flow.hint('memnox sync pair <machine> --fingerprint "<what both show>"');
  return EXIT.OK;
}

/** On the new machine: the fingerprint of the key that arrived, or the proposal to take it. */
async function accept(run: PairRun, fingerprint: string): Promise<number> {
  if (run.fingerprint === undefined)
    return compareFirst(run, fingerprint, 'memnox sync pair');
  return proposed(
    run,
    await run.dial.ask({
      id: 2,
      method: DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT,
      syncFingerprint: run.fingerprint,
    }),
    'Proposed taking the sync key your other machine offered.',
  );
}

/** Nothing arrived yet: which machine this is, for the one holding the key to pick. */
async function waiting(run: PairRun, status: PersonalSyncStatus): Promise<number> {
  const { flow } = run.context;
  const account = await readAccount(run.home);
  if (account === null) return failed(run, status.said);
  flow.value('This machine', account.machineId);
  flow.close(status.said);
  flow.hint(`On the machine holding your key: memnox sync pair ${account.machineId}`);
  return EXIT.OK;
}

function compareFirst(run: PairRun, fingerprint: string, again: string): number {
  const { flow } = run.context;
  flow.value('Fingerprint', fingerprint);
  flow.close('Check that the other machine shows the same, then run it again with it.');
  flow.hint(`${again} --fingerprint "${fingerprint}"`);
  return EXIT.OK;
}

function proposed(run: PairRun, answer: DaemonResponse | null, said: string): number {
  if (answer === null) return failed(run, NO_DAEMON);
  if (!answer.ok || answer.proposed === undefined)
    return failed(run, answer.reason ?? 'The key was not offered.');
  run.context.flow.value('Proposal', answer.proposed);
  run.context.flow.close(`${said} ${SIGN_IT}`);
  return EXIT.OK;
}

function failed(run: PairRun, reason: string): number {
  run.context.flow.fail(reason);
  return EXIT.FAILED;
}
