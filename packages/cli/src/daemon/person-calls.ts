import { setTimeout as sleep } from 'node:timers/promises';
import {
  DAEMON_METHOD,
  readAccount,
  type DaemonRequest,
  type DaemonResponse,
  type PersonStanding,
} from '@memnox/core';
import { DEFAULT_BASE_URL } from '../sync/connect';
import { claimDeviceSpace } from '../sync/device-space';
import {
  awaitPerson,
  enrolPerson,
  readPerson,
  requestPersonCode,
  signOutPerson,
  type Granted,
  type PersonCode,
  type PersonCredential,
} from '../sync/person';

/**
 * The daemon's own person sign in, driven from the Mac app's Account page so nobody has to open
 * a terminal for it. It is the same flow `memnox signin` runs: a code approved in the browser,
 * a key that never leaves this machine, and `~/.memnox/person.json` at the end of it.
 */

/** The code flow, as the command runs it, behind a seam so a test needs no control plane. */
export interface PersonSignInFlow {
  current(): Promise<PersonCredential | null>;
  baseUrl(): Promise<string>;
  requestCode(baseUrl: string, companionOf?: string): Promise<PersonCode>;
  awaitApproval(baseUrl: string, code: PersonCode): Promise<Granted>;
  enrol(baseUrl: string, granted: Granted): Promise<PersonCredential>;
  signOut(person: PersonCredential): Promise<void>;
}

export function personSignInFlow(home: string): PersonSignInFlow {
  return {
    current: () => readPerson(home),
    baseUrl: async () => (await readAccount(home))?.baseUrl ?? DEFAULT_BASE_URL,
    requestCode: (baseUrl, companionOf) => requestPersonCode(baseUrl, companionOf),
    awaitApproval: (baseUrl, code) => awaitPerson(baseUrl, code, (ms) => sleep(ms)),
    enrol: async (baseUrl, granted) => {
      const person = await enrolPerson(home, baseUrl, granted);
      // What this Mac connected before any account becomes the person's, so nothing is connected twice.
      await claimDeviceSpace(home).catch(() => null);
      return person;
    },
    signOut: (person) => signOutPerson(home, person),
  };
}

export function isPersonMethod(method: string): boolean {
  return (
    method === DAEMON_METHOD.PERSON ||
    method === DAEMON_METHOD.PERSON_SIGN_IN ||
    method === DAEMON_METHOD.PERSON_SIGN_OUT
  );
}

/** One sign in at a time: the code live now, and why the last one stopped, until the next starts. */
export class PersonSignIns {
  private pending: { code: PersonCode; done: Promise<void> } | null = null;
  private failed: string | null = null;

  /** `signedIn` hears the credential once there is one, so this machine connects on the same approval. */
  constructor(
    private readonly flow: PersonSignInFlow,
    private readonly signedIn: (
      person: PersonCredential,
      label: string | undefined,
    ) => Promise<void> = async () => undefined,
  ) {}

  async standing(): Promise<PersonStanding> {
    const person = await this.flow.current();
    if (person !== null) {
      return { signedIn: true, name: person.name, workspaceId: person.workspaceId };
    }
    const code = this.pending?.code;
    return {
      signedIn: false,
      ...(code === undefined
        ? {}
        : {
            code: {
              userCode: code.userCode,
              expiresAt: code.expiresAt,
              ...(pageOf(code) === undefined ? {} : { page: pageOf(code) }),
            },
          }),
      ...(this.failed === null ? {} : { failed: this.failed }),
    };
  }

  /**
   * Starts the flow and answers with the code; approval is waited for behind the answer. Already
   * signed in, it only completes what the sign in carries, so nothing held is asked for again.
   */
  async begin(companionOf?: string, label?: string): Promise<PersonStanding> {
    if (this.pending !== null) return this.standing();
    const person = await this.flow.current();
    if (person !== null) {
      // Behind the answer, since the machine's own approval polls for a few seconds.
      void this.signedIn(person, label).catch(() => undefined);
      return this.standing();
    }
    this.failed = null;
    const baseUrl = await this.flow.baseUrl();
    const code = await this.flow.requestCode(baseUrl, companionOf);
    const done = this.finish(baseUrl, code, label);
    this.pending = { code, done };
    return this.standing();
  }

  async signOut(): Promise<PersonStanding> {
    const person = await this.flow.current();
    if (person !== null) await this.flow.signOut(person);
    return this.standing();
  }

  /** Awaited by tests, which have no clock to wait on. */
  async settled(): Promise<void> {
    await this.pending?.done;
  }

  private async finish(
    baseUrl: string,
    code: PersonCode,
    label: string | undefined,
  ): Promise<void> {
    try {
      const granted = await this.flow.awaitApproval(baseUrl, code);
      const person = await this.flow.enrol(baseUrl, granted);
      // The machine's connection is its own credential, so a failure there leaves the person signed in.
      await this.signedIn(person, label).catch(() => undefined);
    } catch (err) {
      this.failed = err instanceof Error ? err.message : String(err);
    } finally {
      this.pending = null;
    }
  }
}

/** The Mac app's Account page asking, starting or ending the daemon's own sign in. */
export async function answerPerson(
  request: DaemonRequest,
  signIns: PersonSignIns | undefined,
): Promise<DaemonResponse> {
  if (signIns === undefined) {
    return { id: request.id, ok: false, error: 'this daemon has no person sign in' };
  }
  try {
    const person =
      request.method === DAEMON_METHOD.PERSON_SIGN_IN
        ? await signIns.begin(companionOf(request), labelOf(request))
        : request.method === DAEMON_METHOD.PERSON_SIGN_OUT
          ? await signIns.signOut()
          : await signIns.standing();
    return { id: request.id, ok: true, person };
  } catch (err) {
    return {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The Mac app's own waiting code, when it asked for both to be approved at once. */
function companionOf(request: DaemonRequest): string | undefined {
  const code = request.companionOf?.trim();
  return code === undefined || code === '' ? undefined : code;
}

/** What the workspace will call this machine when it connects on the same approval. */
function labelOf(request: DaemonRequest): string | undefined {
  const name = request.name?.trim();
  return name === undefined || name === '' ? undefined : name;
}

function pageOf(code: PersonCode): string | undefined {
  return code.verificationUriComplete ?? code.verificationUri;
}
