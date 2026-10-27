import { hostname, platform } from 'node:os';

import {
  ENFORCEMENT_MODE,
  loadOrCreateConfig,
  saveConfig,
  writeAccount,
  accountPathFor,
  detectMachineClass,
  type Account,
  type MachineClass,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import { askOnTerminal, type NameAsker } from '../agents/name-prompt';
import { Flow } from '../flow';
import { openBrowser } from './browser';
import { insecureBaseUrl } from './client';
import { claimDeviceSpace } from './device-space';
import {
  accountFrom,
  approvalUrl,
  CloudUnreachable,
  EnrolmentRefused,
  goodFor,
  joinWithToken,
  machineKeypair,
  pageCarriesCode,
  requestCode,
  waitForApproval,
  type Collected,
  type DeviceOffer,
  type WaitSeams,
} from './enrol';

/**
 * Binding this machine to a workspace, once, shared by `login` and the guided first run
 * so there is one device flow and one check that refuses `http://`.
 */

export { DEFAULT_BASE_URL } from './cloud-url';

interface ConnectOptions {
  url: string;
  enforce?: boolean;
  /** False prints the URL and the code rather than opening a browser. */
  open?: boolean;
  /** Given rather than asked for, so a script names each box and never hangs on a question. */
  name?: string;
  /** Said by the person with --class, otherwise read off this machine. */
  machineClass?: MachineClass;
  /** A single use token from the console, which stands in for approving in a browser. */
  joinToken?: string;
}

export type ConnectSeams = WaitSeams & {
  /** Answers whether a browser actually opened, because the screen turns on it. */
  open?: (url: string) => Promise<boolean> | boolean;
  /** The same asker the agents are named with, so one prompt style serves both. */
  askName?: NameAsker;
  /** Whether anybody can be asked. False asks nothing and enrols unnamed. */
  interactive?: () => boolean;
};

interface EnrolmentRequest {
  baseUrl: string;
  mode?: string;
  label?: string;
  machineClass?: MachineClass;
}

interface ApprovalStepInput {
  flow: Flow;
  options: ConnectOptions;
  offer: DeviceOffer;
  seams: ConnectSeams;
}

interface EnrolledInput {
  flow: Flow;
  home: string;
  named: string | undefined;
  collected: Collected;
}

interface Connected {
  account: Account;
  machineId: string;
  workspaceId: string;
  mode: string;
}

export async function connectMachine(
  context: CliContext,
  home: string,
  options: ConnectOptions,
  seams: ConnectSeams = {},
): Promise<Connected> {
  // The run's own rail, so `login` and `setup` share one gutter without handing one over.
  const { flow } = context;
  refuseInsecure(options.url);
  flow.step('Control plane', options.url);

  const named = await nameFor(options, flow, seams);
  const keys = machineKeypair();
  flow.step('Machine key generated', 'ed25519, never leaves this machine');

  const enrolment: EnrolmentRequest = {
    baseUrl: options.url,
    ...(options.enforce === true ? { mode: ENFORCEMENT_MODE.ENFORCE } : {}),
    ...(named === undefined ? {} : { label: named }),
    machineClass: options.machineClass ?? detectMachineClass(platform(), process.env),
  };
  const collected = await approvedBy(flow, {
    enrolment,
    options,
    seams,
    publicKey: keys.publicKey,
  });

  const account = accountFrom(enrolment, keys, collected, new Date().toISOString());
  await writeAccount(home, account);
  // A space this Mac acted in before any account moves its paired phones onto this machine now.
  await claimDeviceSpace(home).catch(() => null);
  if (options.enforce === true) await enforceHere(home);
  renderEnrolled({ flow, home, named, collected });

  return {
    account,
    machineId: collected.machineId,
    workspaceId: collected.workspaceId,
    mode: collected.mode,
  };
}

interface Approval {
  enrolment: EnrolmentRequest;
  options: ConnectOptions;
  seams: ConnectSeams;
  publicKey: string;
}

/** A join token from the console, or a person approving in the browser, whichever this run has. */
async function approvedBy(flow: Flow, approval: Approval): Promise<Collected> {
  const { enrolment, options, seams, publicKey } = approval;
  const joinToken = options.joinToken;
  if (joinToken !== undefined) {
    flow.step('Joining with the token from the console');
    return refusedPlainly(enrolment.baseUrl, () =>
      joinWithToken({ ...enrolment, joinToken }, publicKey),
    );
  }
  const offer = await request(enrolment, publicKey);
  await renderApprovalStep({ flow, options, offer, seams });
  return waitForApproval(options.url, offer, seams);
}

/** A refusal said in a sentence, and an unreachable plane said as one that changed nothing. */
async function refusedPlainly<T>(baseUrl: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CloudUnreachable) {
      throw new Error(`Could not reach ${baseUrl}. This machine is unchanged.`);
    }
    if (err instanceof EnrolmentRefused) throw new Error(err.message);
    throw err;
  }
}

/** Before a key is generated, so a refused URL never reads as a network fault. */
function refuseInsecure(url: string): void {
  const insecure = insecureBaseUrl(url);
  if (insecure === null) return;
  throw new Error(
    `${insecure}. Use https, or a control plane on localhost while you develop against one.`,
  );
}

/**
 * Straight to the page, since its link carries the code, and the code printed only where
 * no browser opened or the page lacks it. The deadline is named, so the wait is not a hang.
 */
async function renderApprovalStep(input: ApprovalStepInput): Promise<void> {
  const { flow, options, offer, seams } = input;
  const url = approvalUrl(options.url, offer.userCode, offer);
  const opened = options.open === false ? false : await (seams.open ?? openBrowser)(url);

  if (opened) {
    flow.step('Approving in your browser', url);
  } else {
    flow.step('Approve at', url);
  }
  if (!opened || !pageCarriesCode(offer)) {
    flow.value('Your code', offer.userCode);
  }
  flow.step(
    'Waiting for approval…',
    `the code is good for ${goodFor(offer)}. Ctrl+C stops, and nothing will change.`,
  );
}

/** Only on `--enforce`, because a login must never move a machine out of its owner's mode silently. */
async function enforceHere(home: string): Promise<void> {
  const current = await loadOrCreateConfig(home);
  if (current.mode !== ENFORCEMENT_MODE.ENFORCE) {
    await saveConfig(home, { ...current, mode: ENFORCEMENT_MODE.ENFORCE });
  }
}

/** Shown unasked, because this is the moment the machine stops being local only. */
function renderEnrolled(input: EnrolledInput): void {
  const { flow, home, named, collected } = input;
  flow.rows('Enrolled', [
    ...(named === undefined ? [] : [{ label: 'name', value: named }]),
    { label: 'machine', value: collected.machineId },
    { label: 'workspace', value: collected.workspaceId },
    { label: 'mode', value: collected.mode },
    { label: 'credential', value: accountPathFor(home) },
  ]);
}

/**
 * What this workspace will call this machine, decided before anything is minted: the
 * hostname only suggested, since the plane never stores it. `--name`, a question, or nothing.
 */
async function nameFor(
  options: ConnectOptions,
  flow: Flow,
  seams: ConnectSeams,
): Promise<string | undefined> {
  const given = options.name?.trim();
  if (given !== undefined && given !== '') return given;

  const canAsk = seams.interactive ?? (() => process.stdin.isTTY === true);
  if (!canAsk()) return undefined;

  const suggested = hostname();
  const answer = await (seams.askName ?? askOnTerminal)({
    shown: suggested,
    lines: [],
    gutter: flow.prompt,
    because: 'Call this machine something your workspace will recognise',
  }).catch(() => null);
  const wanted = (answer ?? suggested).trim();
  return wanted === '' ? undefined : wanted;
}

async function request(
  enrolment: EnrolmentRequest,
  publicKey: string,
): Promise<DeviceOffer> {
  try {
    return await requestCode(enrolment, publicKey);
  } catch (err) {
    if (err instanceof CloudUnreachable) {
      throw new Error(
        `Could not reach ${enrolment.baseUrl}. This machine is unchanged and still enforcing whatever it already had.`,
      );
    }
    if (err instanceof EnrolmentRefused) throw new Error(err.message);
    throw err;
  }
}
