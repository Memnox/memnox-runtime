import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  confirmationMessage,
  HTTP,
  MEMNOX_HOME,
  readJsonFile,
  writeJsonFile,
} from '@memnox/core';
import { callCloud } from './client';

/**
 * A person signed in from this terminal with `memnox signin`, apart from the machine's own
 * credential: what lets `memnox inbox` show the questions a workspace routed to them and answer
 * one, signed by a key that never leaves this machine, as the phone signs with Face ID.
 */

const PERSON_FILE = 'person.json';

/** Never faster than this, whatever the control plane says, so a zero is never a busy loop. */
const SLOWEST_POLL_MS = 1_000;

export interface PersonCredential {
  baseUrl: string;
  token: string;
  personId: string;
  name: string;
  workspaceId: string;
  deviceId: string;
  /** P-256 PKCS8 PEM, owner only. Signs every yes this terminal gives. */
  privateKey: string;
}

/** A question the workspace routed to this person, as the inbox lists it. */
export interface TeamHeld {
  id: string;
  machineLabel?: string;
  machineId: string;
  agent: string;
  operation: string;
  target?: string;
  summary?: string;
  reason: string;
  expiresAt: string;
  escalated: boolean;
  approvalsNeeded: number;
}

export interface PersonCode {
  deviceCode: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt: number;
  verificationUri?: string;
  verificationUriComplete?: string;
}

export interface Granted {
  token: string;
  personId: string;
  name: string;
  orgId?: string;
}

function personPathFor(home: string): string {
  return join(home, MEMNOX_HOME, PERSON_FILE);
}

export async function readPerson(home: string): Promise<PersonCredential | null> {
  return readJsonFile<PersonCredential>(personPathFor(home));
}

async function forgetPerson(home: string): Promise<void> {
  await rm(personPathFor(home), { force: true });
}

/** `companionOf` is the Mac app's own device code, so one approval in the browser signs both in. */
export async function requestPersonCode(
  baseUrl: string,
  companionOf?: string,
): Promise<PersonCode> {
  const answer = await callCloud<PersonCode>({
    baseUrl,
    path: '/v1/person/codes',
    method: 'POST',
    body: {
      name: `${hostname()} terminal`,
      kind: 'desktop',
      ...(companionOf === undefined ? {} : { companionOf }),
    },
  });
  if (answer.body === undefined || answer.status >= HTTP.BAD_REQUEST) {
    throw new Error(
      'The control plane would not start a sign in. Try again in a moment.',
    );
  }
  return answer.body;
}

/** Polls until the person approves in the browser, refuses, or the code runs out. */
export async function awaitPerson(
  baseUrl: string,
  code: PersonCode,
  wait: (ms: number) => Promise<void>,
): Promise<Granted> {
  const every = Math.max(code.intervalSeconds * 1_000, SLOWEST_POLL_MS);
  while (Date.now() < code.expiresAt) {
    const answer = await callCloud<Granted & { error?: string }>({
      baseUrl,
      path: '/v1/person/tokens',
      method: 'POST',
      body: { deviceCode: code.deviceCode },
    });
    if (answer.status === HTTP.OK && answer.body?.token !== undefined) return answer.body;
    if (answer.body?.error !== 'authorization_pending') {
      throw new Error(
        `The sign in was not approved (${answer.body?.error ?? answer.status}).`,
      );
    }
    await wait(every);
  }
  throw new Error('The code ran out before it was approved. Run memnox signin again.');
}

/** Picks the workspace in the person's organisation, then registers this terminal's key there. */
export async function enrolPerson(
  home: string,
  baseUrl: string,
  granted: Granted,
): Promise<PersonCredential> {
  const workspace = await workspaceOf(baseUrl, granted);
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = await callCloud<{ id?: string }>({
    baseUrl,
    path: '/v1/me/devices',
    method: 'POST',
    token: granted.token,
    body: {
      name: `${hostname()} terminal`,
      kind: 'desktop',
      signingPoint: pointOf(keys.publicKey),
    },
  });
  if (device.body?.id === undefined)
    throw new Error('This terminal could not be registered.');
  const person: PersonCredential = {
    baseUrl,
    token: granted.token,
    personId: granted.personId,
    name: granted.name,
    workspaceId: workspace.id,
    deviceId: device.body.id,
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  await writeJsonFile(personPathFor(home), person);
  return person;
}

/** The workspace in the person's organisation, or the first they can see. */
async function workspaceOf(baseUrl: string, granted: Granted): Promise<{ id: string }> {
  const me = await callCloud<{ workspaces?: { id: string; orgId?: string }[] }>({
    baseUrl,
    path: '/v1/me',
    token: granted.token,
  });
  const workspaces = me.body?.workspaces ?? [];
  const workspace =
    workspaces.find((each) => each.orgId === granted.orgId) ?? workspaces[0];
  if (workspace === undefined) {
    throw new Error('This person has no workspace to answer in.');
  }
  return workspace;
}

/** Revokes this terminal on the control plane, then forgets it here whatever was answered. */
export async function signOutPerson(
  home: string,
  person: PersonCredential,
): Promise<void> {
  await callCloud({
    baseUrl: person.baseUrl,
    path: `/v1/me/devices/${encodeURIComponent(person.deviceId)}`,
    method: 'DELETE',
    token: person.token,
  }).catch(() => undefined);
  await forgetPerson(home);
}

export async function teamHeld(person: PersonCredential): Promise<TeamHeld[]> {
  const answer = await callCloud<TeamHeld[]>({
    baseUrl: person.baseUrl,
    path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/held`,
    token: person.token,
  });
  if (answer.status === HTTP.UNAUTHORIZED) {
    throw new Error('The workspace signed this terminal out. Run memnox signin again.');
  }
  return Array.isArray(answer.body) ? answer.body : [];
}

/** A yes signed by this terminal's key over the same words a phone signs; a no goes unsigned. */
export async function answerTeamHeld(
  person: PersonCredential,
  id: string,
  answer: string,
): Promise<{
  status: number;
  body?: { status?: string; approvalsNeeded?: number; error?: string };
}> {
  const signature =
    answer === 'deny'
      ? undefined
      : sign('sha256', Buffer.from(confirmationMessage(id, answer)), {
          key: createPrivateKey(person.privateKey),
          dsaEncoding: 'der',
        }).toString('base64');
  return callCloud({
    baseUrl: person.baseUrl,
    path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/held/${encodeURIComponent(id)}`,
    method: 'POST',
    token: person.token,
    body: {
      answer,
      deviceId: person.deviceId,
      ...(signature === undefined ? {} : { signature }),
    },
  });
}

/** The uncompressed X9.63 point the control plane checks a yes against: 0x04, then X and Y. */
function pointOf(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): string {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x ?? '', 'base64url');
  const y = Buffer.from(jwk.y ?? '', 'base64url');
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64');
}
