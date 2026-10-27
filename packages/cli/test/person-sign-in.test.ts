import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeResponse, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import {
  answerPerson,
  PersonSignIns,
  type PersonSignInFlow,
} from '../src/daemon/person-calls';
import { VoiceSurface } from '../src/daemon/voice-surface';
import type { Granted, PersonCode, PersonCredential } from '../src/sync/person';

const CODE: PersonCode = {
  deviceCode: 'dc_1',
  userCode: 'ABCD-EFGH',
  intervalSeconds: 5,
  expiresAt: 1_791_281_400_000,
  verificationUri: 'https://console.memnox.test/apps/connect',
  verificationUriComplete: 'https://console.memnox.test/apps/connect?code=ABCD-EFGH',
};

const GRANTED: Granted = { token: 'mnx_person', personId: 'usr_ana', name: 'Ana' };

function credential(): PersonCredential {
  return {
    baseUrl: 'https://api.memnox.test',
    token: 'mnx_person',
    personId: 'usr_ana',
    name: 'Ana',
    workspaceId: 'ws_1',
    deviceId: 'pdv_1',
    privateKey: 'pem',
  };
}

/** A flow with no control plane: each approval is a promise the test settles, the credential a slot. */
function flow(...approvals: Promise<Granted>[]): {
  flow: PersonSignInFlow;
  calls: string[];
  kept: { person: PersonCredential | null };
} {
  const calls: string[] = [];
  const kept: { person: PersonCredential | null } = { person: null };
  return {
    calls,
    kept,
    flow: {
      current: async () => kept.person,
      baseUrl: async () => 'https://api.memnox.test',
      requestCode: async (_baseUrl, companionOf) => {
        calls.push(companionOf === undefined ? 'code' : `code with ${companionOf}`);
        return CODE;
      },
      // After the last one given, an approval that never comes, as a code nobody approves.
      awaitApproval: () => approvals.shift() ?? new Promise<Granted>(() => undefined),
      enrol: async (_baseUrl, granted) => {
        calls.push(`enrol ${granted.name}`);
        kept.person = credential();
        return kept.person;
      },
      signOut: async () => {
        calls.push('sign out');
        kept.person = null;
      },
    },
  };
}

describe('the daemon signs a person in for the Mac app', () => {
  it('answers with the code at once and is signed in once the browser approved it', async () => {
    let approve: (granted: Granted) => void = () => undefined;
    const approval = new Promise<Granted>((resolve) => {
      approve = resolve;
    });
    const { flow: seam, calls, kept } = flow(approval);
    const signIns = new PersonSignIns(seam);
    expect(await signIns.standing()).toEqual({ signedIn: false });

    const begun = await signIns.begin();
    expect(begun).toEqual({
      signedIn: false,
      code: {
        userCode: 'ABCD-EFGH',
        expiresAt: CODE.expiresAt,
        page: 'https://console.memnox.test/apps/connect?code=ABCD-EFGH',
      },
    });
    // A second start while the code is live is the same code, never a second browser page.
    expect(await signIns.begin()).toEqual(begun);
    expect(calls).toEqual(['code']);

    approve(GRANTED);
    await signIns.settled();
    expect(await signIns.standing()).toEqual({
      signedIn: true,
      name: 'Ana',
      workspaceId: 'ws_1',
    });
    expect(calls).toEqual(['code', 'enrol Ana']);
    expect(kept.person?.name).toBe('Ana');

    expect(await signIns.signOut()).toEqual({ signedIn: false });
    expect(calls.at(-1)).toBe('sign out');
  });

  it("rides on the app's own approval and then connects this machine, asking nothing held twice", async () => {
    const { flow: seam, calls } = flow(Promise.resolve(GRANTED));
    const connected: string[] = [];
    const signIns = new PersonSignIns(seam, async (person, label) => {
      connected.push(`${person.workspaceId} as ${label ?? 'no name'}`);
    });
    await signIns.begin('dc_app', 'Studio Mac');
    await signIns.settled();
    expect(calls).toEqual(['code with dc_app', 'enrol Ana']);
    expect(connected).toEqual(['ws_1 as Studio Mac']);
    // Signed in already: no new code, only the machine completed if it is missing.
    await signIns.begin('dc_app', 'Studio Mac');
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(['code with dc_app', 'enrol Ana']);
    expect(connected).toHaveLength(2);
  });

  it('keeps why a sign in stopped until the next one starts', async () => {
    const { flow: seam } = flow(
      Promise.reject(
        new Error('The code ran out before it was approved. Run memnox signin again.'),
      ),
    );
    const signIns = new PersonSignIns(seam);
    await signIns.begin();
    await signIns.settled();
    expect(await signIns.standing()).toEqual({
      signedIn: false,
      failed: 'The code ran out before it was approved. Run memnox signin again.',
    });
    await signIns.begin();
    expect((await signIns.standing()).failed).toBeUndefined();
  });

  it('refuses plainly on a daemon with no sign in wired', async () => {
    const request: DaemonRequest = { id: 1, method: 'person' };
    expect(await answerPerson(request, undefined)).toEqual({
      id: 1,
      ok: false,
      error: 'this daemon has no person sign in',
    });
  });

  it('is reached through the voice surface the Mac app talks to', async () => {
    const { flow: seam } = flow(new Promise<Granted>(() => undefined));
    const home = await mkdtemp(join(tmpdir(), 'memnox-person-surface-'));
    const surface = new VoiceSurface({
      home,
      now: () => 'now',
      log: () => undefined,
      person: new PersonSignIns(seam),
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
    await surface.respond(peer, { id: 7, method: 'person-sign-in' });
    expect(said[0]).toMatchObject({ id: 7, ok: true, person: { signedIn: false } });
    expect(said[0]?.person?.code?.userCode).toBe('ABCD-EFGH');
    surface.close();
  });
});
