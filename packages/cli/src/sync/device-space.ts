import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  confirmationMessage,
  HTTP,
  MEMNOX_HOME,
  readAccount,
  readJsonFile,
  writeJsonFile,
  type Account,
} from '@memnox/core';
import { CLI_VERSION } from '../defaults';
import { callCloud, CloudUnreachable } from './client';
import { machineKeypair } from './enrol';
import { readPerson, type PersonCredential } from './person';

/**
 * A Mac acting for its person with no Memnox account: on first need it registers two keys as a hidden
 * personal space of one machine, and signs its tools, its phone's relay and its confirmed sends as that.
 * Signing in later claims all of it, so nothing is connected or paired twice.
 */

const DEVICE_SPACE_FILE = 'device-space.json';
const DEVICE_SPACE_VERSION = 1;
const REGISTER_PATH = '/v1/device-spaces';
/** Leading zero hex digits the cloud asks of a registration, which keeps minting spaces from costing nothing. */
const DEVICE_SPACE_WORK_ZEROS = 5;
/** Lowers the work for a test, whose slower machine cannot spend seconds of hashing per space; the cloud still asks five. */
const WORK_ZEROS_VAR = 'MEMNOX_DEVICE_SPACE_WORK_ZEROS';
const WORK_PREFIX = 'memnox-device-space:v1:';
/** Hashes tried before yielding, so the proof never holds the daemon's other callers for long. */
const WORK_SLICE = 20_000;
/** What a claim signs as its subject, so a claim signature confirms nothing else. */
const CLAIM_SUBJECT = 'device-claim:';

export interface DeviceSpace {
  version: number;
  baseUrl: string;
  workspaceId: string;
  machineId: string;
  /** The machine credential the cloud minted for this space. */
  token: string;
  /** Ed25519 PKCS8 PEM, the machine's batch key. */
  privateKey: string;
  /** P-256 PKCS8 PEM: signs every confirmed send and the claim. */
  signingKey: string;
  /** The person device a confirmed run names. */
  deviceId: string;
  personId: string;
  registeredAt: string;
  /** Set once the space opened a relay mailbox, so its phones are carried as this machine until a claim. */
  relay?: true;
  /** Set once a signed in person took the space's connections, and its mailboxes where a machine was named. */
  claimed?: { workspaceId: string; personId: string; at: string; machineId?: string };
}

interface Registered {
  workspaceId?: string;
  machineId?: string;
  token?: string;
  deviceId?: string;
  personId?: string;
}

/** What registering reaches, so a test runs it with no cloud. */
interface DeviceSpaceSeams {
  call?: typeof callCloud;
  now?: () => Date;
}

function spacePathFor(home: string): string {
  return join(home, MEMNOX_HOME, DEVICE_SPACE_FILE);
}

export async function readDeviceSpace(home: string): Promise<DeviceSpace | null> {
  const found = await readJsonFile<DeviceSpace>(spacePathFor(home));
  return found !== null && typeof found.token === 'string' ? found : null;
}

/** One registration per home at a time, so two first needs at once make one space rather than two. */
const registering = new Map<string, Promise<DeviceSpace | null>>();

/** The space this Mac acts in, registered the first time it is needed; null when the cloud cannot be reached. */
export async function ensureDeviceSpace(
  home: string,
  baseUrl: string,
  seams: DeviceSpaceSeams = {},
): Promise<DeviceSpace | null> {
  const found = await readDeviceSpace(home);
  if (found !== null) return found;
  const running = registering.get(home);
  if (running !== undefined) return running;
  const started = registerDeviceSpace(home, baseUrl, seams).finally(() =>
    registering.delete(home),
  );
  registering.set(home, started);
  return started;
}

async function registerDeviceSpace(
  home: string,
  baseUrl: string,
  seams: DeviceSpaceSeams,
): Promise<DeviceSpace | null> {
  const machine = machineKeypair();
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signingPoint = pointOf(signing.publicKey);
  const body = await registered(seams, baseUrl, {
    publicKey: machine.publicKey,
    signingPoint,
    hostname: hostname(),
    runtimeVersion: CLI_VERSION,
    nonce: await proofOfWork(signingPoint),
  });
  if (
    body === null ||
    body.workspaceId === undefined ||
    body.machineId === undefined ||
    body.token === undefined ||
    body.deviceId === undefined ||
    body.personId === undefined
  ) {
    return null;
  }
  const space: DeviceSpace = {
    version: DEVICE_SPACE_VERSION,
    baseUrl,
    workspaceId: body.workspaceId,
    machineId: body.machineId,
    token: body.token,
    privateKey: machine.privateKey,
    signingKey: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    deviceId: body.deviceId,
    personId: body.personId,
    registeredAt: (seams.now ?? (() => new Date()))().toISOString(),
  };
  await writeJsonFile(spacePathFor(home), space);
  return space;
}

/** The cloud's answer to one registration; null when it refused or could not be reached. */
async function registered(
  seams: DeviceSpaceSeams,
  baseUrl: string,
  body: Record<string, string>,
): Promise<Registered | null> {
  try {
    const answer = await (seams.call ?? callCloud)<Registered>({
      baseUrl,
      path: REGISTER_PATH,
      method: 'POST',
      body,
    });
    const created = answer.status === HTTP.CREATED || answer.status === HTTP.OK;
    return created ? (answer.body ?? null) : null;
  } catch (err) {
    if (err instanceof CloudUnreachable) return null;
    throw err;
  }
}

/** The nonce whose hash with the signing point opens on enough zeros; yields between slices. */
async function proofOfWork(
  signingPoint: string,
  zeros: number = deviceSpaceWorkZeros(),
): Promise<string> {
  const wanted = '0'.repeat(zeros);
  for (let start = 0; ; start += WORK_SLICE) {
    for (let at = start; at < start + WORK_SLICE; at += 1) {
      const nonce = at.toString(36);
      if (proofDigest(signingPoint, nonce).startsWith(wanted)) return nonce;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** The zeros a registration hashes for: the cloud's five unless the environment names fewer. */
export function deviceSpaceWorkZeros(env: NodeJS.ProcessEnv = process.env): number {
  const named = Number(env[WORK_ZEROS_VAR]);
  return Number.isInteger(named) && named > 0 && named < DEVICE_SPACE_WORK_ZEROS
    ? named
    : DEVICE_SPACE_WORK_ZEROS;
}

export function proofDigest(signingPoint: string, nonce: string): string {
  return createHash('sha256')
    .update(`${WORK_PREFIX}${signingPoint}:${nonce}`)
    .digest('hex');
}

/** The space as the personal routes take a caller: its machine credential, and its own signing device. */
export type PersonalCaller = Pick<
  PersonCredential,
  'baseUrl' | 'token' | 'workspaceId' | 'deviceId' | 'privateKey'
>;

export function spaceAsCaller(space: DeviceSpace): PersonalCaller {
  return {
    baseUrl: space.baseUrl,
    token: space.token,
    workspaceId: space.workspaceId,
    deviceId: space.deviceId,
    privateKey: space.signingKey,
  };
}

/** The space as the relay takes a machine, so pairing a phone needs no account either. */
function spaceAsAccount(space: DeviceSpace): Account {
  return {
    version: DEVICE_SPACE_VERSION,
    baseUrl: space.baseUrl,
    workspaceId: space.workspaceId,
    machineId: space.machineId,
    token: space.token,
    privateKey: space.privateKey,
    enrolledAt: space.registeredAt,
  };
}

/** Where a space is registered when nothing names a control plane: the machine's own, else Memnox's. */
export async function spaceBaseUrl(home: string, fallback: string): Promise<string> {
  return (await readAccount(home))?.baseUrl ?? fallback;
}

/**
 * The machine the relay dials as. A space that opened a mailbox keeps carrying its phones until a claim
 * moved them to the account's machine; a Mac with an account and no such space dials as that account,
 * and with neither, a space is taken on only when `create` is given, which pairing does.
 */
export async function relayMachine(
  home: string,
  create: (() => Promise<DeviceSpace | null>) | null,
): Promise<Account | null> {
  const space = await readDeviceSpace(home);
  const account = await readAccount(home);
  if (
    space?.relay === true &&
    (account === null || space.claimed?.machineId === undefined)
  )
    return spaceAsAccount(space);
  if (account !== null) return account;
  if (create === null) return null;
  const made = space ?? (await create());
  if (made === null) return null;
  const relaying: DeviceSpace = { ...made, relay: true };
  await writeJsonFile(spacePathFor(home), relaying);
  return spaceAsAccount(relaying);
}

interface ClaimAnswer {
  claimed: boolean;
  connections?: number;
  mailboxes?: number;
}

/**
 * Hands the space to the person now signed in: their connections stay connected and a paired phone stays
 * paired. Signed with the space's own key, so only this Mac can give it away. Best effort, and asked again
 * once a machine is enrolled, since that is when the mailboxes can move.
 */
export async function claimDeviceSpace(
  home: string,
  seams: DeviceSpaceSeams = {},
): Promise<ClaimAnswer | null> {
  const space = await readDeviceSpace(home);
  const person = await readPerson(home);
  if (space === null || person === null) return null;
  const account = await readAccount(home);
  const machineId =
    account !== null &&
    account.revokedAt === undefined &&
    account.workspaceId === person.workspaceId
      ? account.machineId
      : undefined;
  if (
    space.claimed?.workspaceId === person.workspaceId &&
    space.claimed.personId === person.personId &&
    (machineId === undefined || space.claimed.machineId === machineId)
  ) {
    return { claimed: true };
  }
  try {
    const answer = await (seams.call ?? callCloud)<ClaimAnswer>({
      baseUrl: person.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/device-claims`,
      method: 'POST',
      token: person.token,
      body: {
        deviceSpaceId: space.workspaceId,
        deviceMachineId: space.machineId,
        signature: claimSignature(space, person.workspaceId),
        ...(machineId === undefined ? {} : { machineId }),
      },
    });
    if (answer.status !== HTTP.OK || answer.body?.claimed !== true) return null;
    await writeJsonFile(spacePathFor(home), {
      ...space,
      claimed: {
        workspaceId: person.workspaceId,
        personId: person.personId,
        at: (seams.now ?? (() => new Date()))().toISOString(),
        ...(machineId === undefined ? {} : { machineId }),
      },
    } satisfies DeviceSpace);
    return answer.body;
  } catch (err) {
    if (err instanceof CloudUnreachable) return null;
    throw err;
  }
}

/** The space's yes to being claimed into that workspace, over the same words a confirmation is signed with. */
function claimSignature(space: DeviceSpace, workspaceId: string): string {
  return sign(
    'sha256',
    Buffer.from(
      confirmationMessage(`${CLAIM_SUBJECT}${space.workspaceId}`, workspaceId),
      'utf8',
    ),
    { key: createPrivateKey(space.signingKey), dsaEncoding: 'der' },
  ).toString('base64');
}

/** The uncompressed X9.63 point the cloud checks a signature against: 0x04, then X and Y. */
export function pointOf(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x ?? '', 'base64url');
  const y = Buffer.from(jwk.y ?? '', 'base64url');
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64');
}
