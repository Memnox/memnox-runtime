import { platform } from 'node:os';
import {
  DAEMON_METHOD,
  detectMachineClass,
  HTTP,
  forgetAccount,
  readAccount,
  writeAccount,
  type Account,
  type DaemonRequest,
  type DaemonResponse,
  type MachineStanding,
} from '@memnox/core';
import { callCloud } from '../sync/client';
import { DEFAULT_BASE_URL } from '../sync/connect';
import {
  accountFrom,
  approvalUrl,
  machineKeypair,
  requestCode,
  waitForApproval,
  type Collected,
  type DeviceOffer,
} from '../sync/enrol';
import type { PersonCredential } from '../sync/person';

/**
 * Connecting this machine to a workspace from the Mac app, with no terminal: the `memnox login` flow, ending in
 * `~/.memnox/account.json`, which pairing, workspace memory and the rules all read.
 */

type Enrolment = Parameters<typeof requestCode>[0];

/** A code requested, with the key and the request it was made for, held until the browser approves it. */
export interface MachineOffer {
  offer: DeviceOffer;
  enrolment: Enrolment;
  keys: { publicKey: string; privateKey: string };
}

/** The device flow, as the command runs it, behind a seam so a test needs no control plane. */
export interface MachineSignInFlow {
  current(): Promise<Account | null>;
  baseUrl(): Promise<string>;
  requestCode(baseUrl: string, label: string | undefined): Promise<MachineOffer>;
  awaitApproval(baseUrl: string, pending: MachineOffer): Promise<Collected>;
  enrol(pending: MachineOffer, collected: Collected): Promise<Account>;
  signOut(): Promise<void>;
  /** Approves the code as the person signed in here, which any member may do for their own machine. */
  approveAs(person: Approver, pending: MachineOffer): Promise<void>;
}

/** The person whose credential approves this machine, and the workspace it lands in. */
export type Approver = Pick<PersonCredential, 'baseUrl' | 'token' | 'workspaceId'>;

export function machineSignInFlow(
  home: string,
  enrolled: () => void = () => undefined,
): MachineSignInFlow {
  return {
    current: () => readAccount(home),
    // A machine connected before keeps its control plane, so connecting again lands where it was.
    baseUrl: async () => (await readAccount(home))?.baseUrl ?? DEFAULT_BASE_URL,
    requestCode: async (baseUrl, label) => {
      const keys = machineKeypair();
      const enrolment: Enrolment = {
        baseUrl,
        ...(label === undefined ? {} : { label }),
        machineClass: detectMachineClass(platform(), process.env),
      };
      return { offer: await requestCode(enrolment, keys.publicKey), enrolment, keys };
    },
    awaitApproval: (baseUrl, pending) => waitForApproval(baseUrl, pending.offer),
    enrol: async (pending, collected) => {
      const account = accountFrom(
        pending.enrolment,
        pending.keys,
        collected,
        new Date().toISOString(),
      );
      await writeAccount(home, account);
      // Told after the file is there, so a sync loop started on it finds the credential.
      enrolled();
      return account;
    },
    signOut: async () => {
      await forgetAccount(home);
    },
    approveAs: (person, pending) => approveMachine(person, pending.offer.userCode),
  };
}

/** The approval the console page would send, sent with the person's own credential. */
async function approveMachine(person: Approver, userCode: string): Promise<void> {
  const answer = await callCloud<unknown>({
    baseUrl: person.baseUrl,
    path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/device/approvals`,
    method: 'POST',
    token: person.token,
    body: { userCode, approved: true },
  });
  if (answer.status >= HTTP.BAD_REQUEST) {
    throw new Error(`The workspace would not take this Mac (${answer.status}).`);
  }
}

export function isMachineMethod(method: string): boolean {
  return (
    method === DAEMON_METHOD.MACHINE ||
    method === DAEMON_METHOD.MACHINE_SIGN_IN ||
    method === DAEMON_METHOD.MACHINE_SIGN_OUT
  );
}

/** Said of a credential the control plane refused, since the file is kept to say who let it go. */
const LET_GO = 'The workspace let this machine go. Connect again to come back.';

/** One connection at a time: the code live now, and why the last one stopped, until the next starts. */
export class MachineSignIns {
  private pending: { baseUrl: string; code: MachineOffer; done: Promise<void> } | null =
    null;
  private failed: string | null = null;

  constructor(private readonly flow: MachineSignInFlow) {}

  async standing(): Promise<MachineStanding> {
    const account = await this.flow.current();
    if (account !== null && account.revokedAt === undefined) {
      return {
        signedIn: true,
        workspaceId: account.workspaceId,
        machineId: account.machineId,
        ...(account.workspaceName === undefined ? {} : { name: account.workspaceName }),
      };
    }
    const failed = this.failed ?? (account === null ? null : LET_GO);
    const pending = this.pending;
    return {
      signedIn: false,
      ...(pending === null
        ? {}
        : {
            code: {
              userCode: pending.code.offer.userCode,
              expiresAt: pending.code.offer.expiresAt,
              page: approvalUrl(
                pending.baseUrl,
                pending.code.offer.userCode,
                pending.code.offer,
              ),
            },
          }),
      ...(failed === null ? {} : { failed }),
    };
  }

  /** Starts the flow and answers with the code; approval is waited for behind the answer. */
  async begin(label: string | undefined): Promise<MachineStanding> {
    if (this.pending !== null) return this.standing();
    this.failed = null;
    const baseUrl = await this.flow.baseUrl();
    const code = await this.flow.requestCode(baseUrl, label);
    const done = this.finish(baseUrl, code);
    this.pending = { baseUrl, code, done };
    return this.standing();
  }

  /**
   * Connects this machine on the person's own approval, so signing in once in the browser is
   * enough; a machine already connected is left as it is.
   */
  async connectAs(person: Approver, label?: string): Promise<void> {
    if (this.pending !== null || (await this.standing()).signedIn) return;
    this.failed = null;
    const code = await this.flow.requestCode(person.baseUrl, label);
    await this.flow.approveAs(person, code);
    const done = this.finish(person.baseUrl, code);
    this.pending = { baseUrl: person.baseUrl, code, done };
    await done;
  }

  async signOut(): Promise<MachineStanding> {
    await this.flow.signOut();
    this.failed = null;
    return this.standing();
  }

  /** Awaited by tests, which have no clock to wait on. */
  async settled(): Promise<void> {
    await this.pending?.done;
  }

  private async finish(baseUrl: string, code: MachineOffer): Promise<void> {
    try {
      const collected = await this.flow.awaitApproval(baseUrl, code);
      await this.flow.enrol(code, collected);
    } catch (err) {
      this.failed = err instanceof Error ? err.message : String(err);
    } finally {
      this.pending = null;
    }
  }
}

/** The Mac app's Account page asking, starting or ending this machine's connection to its workspace. */
export async function answerMachine(
  request: DaemonRequest,
  signIns: MachineSignIns | undefined,
): Promise<DaemonResponse> {
  if (signIns === undefined) {
    return { id: request.id, ok: false, error: 'this daemon cannot connect the machine' };
  }
  try {
    const machine =
      request.method === DAEMON_METHOD.MACHINE_SIGN_IN
        ? await signIns.begin(labelOf(request))
        : request.method === DAEMON_METHOD.MACHINE_SIGN_OUT
          ? await signIns.signOut()
          : await signIns.standing();
    return { id: request.id, ok: true, machine };
  } catch (err) {
    return {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** What the workspace will call this machine: the name the app sent, which is this Mac's own. */
function labelOf(request: DaemonRequest): string | undefined {
  const name = request.name?.trim();
  return name === undefined || name === '' ? undefined : name;
}
