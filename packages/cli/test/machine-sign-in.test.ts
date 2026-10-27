import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeResponse,
  type Account,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import {
  answerMachine,
  MachineSignIns,
  type MachineOffer,
  type MachineSignInFlow,
} from '../src/daemon/machine-calls';
import { VoiceSurface } from '../src/daemon/voice-surface';
import type { Collected } from '../src/sync/enrol';

const OFFER: MachineOffer = {
  offer: {
    deviceCode: 'dc_1',
    userCode: 'ABCD-EFGH',
    intervalSeconds: 5,
    expiresAt: 1_791_281_400_000,
    verificationUri: 'https://console.memnox.test/machines/connect',
    verificationUriComplete:
      'https://console.memnox.test/machines/connect?code=ABCD-EFGH',
  },
  enrolment: { baseUrl: 'https://api.memnox.test', label: 'Studio Mac' },
  keys: { publicKey: 'pub', privateKey: 'pem' },
};

const COLLECTED: Collected = {
  machineId: 'mch_1',
  token: 'mnx_machine',
  mode: 'observe',
  workspaceId: 'ws_1',
};

function account(revokedAt?: string): Account {
  return {
    version: 1,
    baseUrl: 'https://api.memnox.test',
    workspaceId: 'ws_1',
    workspaceName: 'Viktor',
    machineId: 'mch_1',
    token: 'mnx_machine',
    privateKey: 'pem',
    enrolledAt: '2026-10-13T02:56:58Z',
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

/** A flow with no control plane: each approval is a promise the test settles, the credential a slot. */
function flow(...approvals: Promise<Collected>[]): {
  flow: MachineSignInFlow;
  calls: string[];
  kept: { account: Account | null; enrolled: number };
} {
  const calls: string[] = [];
  const kept: { account: Account | null; enrolled: number } = {
    account: null,
    enrolled: 0,
  };
  return {
    calls,
    kept,
    flow: {
      current: async () => kept.account,
      baseUrl: async () => 'https://api.memnox.test',
      requestCode: async (_baseUrl, label) => {
        calls.push(`code for ${label ?? 'no name'}`);
        return OFFER;
      },
      // After the last one given, an approval that never comes, as a code nobody approves.
      awaitApproval: () => approvals.shift() ?? new Promise<Collected>(() => undefined),
      enrol: async (_pending, collected) => {
        calls.push(`enrol ${collected.workspaceId}`);
        kept.account = account();
        kept.enrolled += 1;
        return kept.account;
      },
      signOut: async () => {
        calls.push('forget');
        kept.account = null;
      },
      approveAs: async (person, pending) => {
        calls.push(
          `approved ${pending.offer.userCode} as ${person.token} in ${person.workspaceId}`,
        );
      },
    },
  };
}

describe('the daemon connects this machine to a workspace for the Mac app', () => {
  it('answers with the code at once and is connected once the browser approved it', async () => {
    let approve: (collected: Collected) => void = () => undefined;
    const approval = new Promise<Collected>((resolve) => {
      approve = resolve;
    });
    const { flow: seam, calls, kept } = flow(approval);
    const signIns = new MachineSignIns(seam);
    expect(await signIns.standing()).toEqual({ signedIn: false });

    const begun = await signIns.begin('Studio Mac');
    expect(begun).toEqual({
      signedIn: false,
      code: {
        userCode: 'ABCD-EFGH',
        expiresAt: OFFER.offer.expiresAt,
        page: 'https://console.memnox.test/machines/connect?code=ABCD-EFGH',
      },
    });
    // A second start while the code is live is the same code, never a second browser page.
    expect(await signIns.begin('Studio Mac')).toEqual(begun);
    expect(calls).toEqual(['code for Studio Mac']);

    approve(COLLECTED);
    await signIns.settled();
    expect(await signIns.standing()).toEqual({
      signedIn: true,
      name: 'Viktor',
      workspaceId: 'ws_1',
      machineId: 'mch_1',
    });
    expect(calls).toEqual(['code for Studio Mac', 'enrol ws_1']);
    expect(kept.enrolled).toBe(1);

    expect(await signIns.signOut()).toEqual({ signedIn: false });
    expect(calls.at(-1)).toBe('forget');
  });

  it("connects on the person's own approval, with no second browser page, and only once", async () => {
    const { flow: seam, calls } = flow(Promise.resolve(COLLECTED));
    const signIns = new MachineSignIns(seam);
    const person = {
      baseUrl: 'https://api.memnox.test',
      token: 'mnx_person',
      workspaceId: 'ws_1',
    };
    await signIns.connectAs(person, 'Studio Mac');
    expect(calls).toEqual([
      'code for Studio Mac',
      'approved ABCD-EFGH as mnx_person in ws_1',
      'enrol ws_1',
    ]);
    expect((await signIns.standing()).signedIn).toBe(true);
    // Already connected, so nothing is asked for again.
    await signIns.connectAs(person, 'Studio Mac');
    expect(calls).toHaveLength(3);
  });

  it('keeps why a connection stopped until the next one starts', async () => {
    const { flow: seam } = flow(
      Promise.reject(new Error('the code expired before anybody approved it')),
    );
    const signIns = new MachineSignIns(seam);
    await signIns.begin(undefined);
    await signIns.settled();
    expect(await signIns.standing()).toEqual({
      signedIn: false,
      failed: 'the code expired before anybody approved it',
    });
    await signIns.begin(undefined);
    expect((await signIns.standing()).failed).toBeUndefined();
  });

  it('says the workspace let the machine go rather than calling a revoked credential connected', async () => {
    const { flow: seam, kept } = flow();
    kept.account = account('2026-10-13T03:00:00Z');
    const signIns = new MachineSignIns(seam);
    expect(await signIns.standing()).toEqual({
      signedIn: false,
      failed: 'The workspace let this machine go. Connect again to come back.',
    });
  });

  it('refuses plainly on a daemon with no machine connection wired', async () => {
    const request: DaemonRequest = { id: 1, method: 'machine' };
    expect(await answerMachine(request, undefined)).toEqual({
      id: 1,
      ok: false,
      error: 'this daemon cannot connect the machine',
    });
  });

  it('is reached through the voice surface the Mac app talks to, named as the app names this Mac', async () => {
    const { flow: seam, calls } = flow(new Promise<Collected>(() => undefined));
    const home = await mkdtemp(join(tmpdir(), 'memnox-machine-surface-'));
    const surface = new VoiceSurface({
      home,
      now: () => 'now',
      log: () => undefined,
      machine: new MachineSignIns(seam),
    });
    const said: DaemonResponse[] = [];
    const peer = {
      destroyed: false,
      write(line: string): boolean {
        const response = decodeResponse(line.trim());
        if (response !== null) said.push(response);
        return true;
      },
      destroy(): void {
        this.destroyed = true;
      },
    };
    await surface.respond(peer, { id: 7, method: 'machine-sign-in', name: 'Studio Mac' });
    expect(said[0]).toMatchObject({ id: 7, ok: true, machine: { signedIn: false } });
    expect(said[0]?.machine?.code?.userCode).toBe('ABCD-EFGH');
    expect(calls).toEqual(['code for Studio Mac']);
    surface.close();
  });
});
