import {
  DEVICE_KIND,
  type Account,
  deviceFingerprint,
  deviceProofMessage,
  isP256Point,
  verifiesSigned,
} from '@memnox/core';
import { FRAME, frame, SecureChannel } from './framing';
import { NOISE_PATTERN, type Noise, type NoiseHandshake } from './noise';
import type { NoiseKeypair } from './remote-files';
import type { OpenedMailbox } from '../sync/relay';

/**
 * The runtime's side of pairing: an XXpsk0 handshake with the QR's secret, the device's name and
 * keys inside it, and a proof that it holds its signing key. Nothing is trusted until the person says yes.
 */

/** Where a phone on the same network meets this machine, beside or instead of the relay. */
export interface QrLan {
  /** This machine's private addresses, any of which reaches the listener. */
  hosts: string[];
  port: number;
  /** The random Bonjour name, so a phone knows which `_memnox._tcp` announcement is this machine. */
  instance: string;
}

/**
 * What the QR carries: where to meet, the key to expect, and a secret good for one handshake.
 * Version 1 names the relay and may name the local network too; version 2 names only the local
 * network, so a phone that knows only the relay says it cannot pair rather than failing on it.
 */
export interface QrPayload {
  v: typeof QR_VERSION.RELAY | typeof QR_VERSION.LAN_ONLY;
  machineId: string;
  machine: string;
  relayUrl?: string;
  mailbox: string;
  pairingToken?: string;
  runtimeNoiseStatic: string;
  secret: string;
  expiresAt: string;
  lan?: QrLan;
}

export const QR_VERSION = { RELAY: 1, LAN_ONLY: 2 } as const;

/** The local network as a QR names it, with the id that names the machine where no account does. */
export interface LanInvite extends QrLan {
  machineId: string;
}

/** Where a phone meets this machine: the relay, the local network, or both. */
export interface Meeting {
  lan: LanInvite | null;
  relay: { account: Account; opened: OpenedMailbox } | null;
}

/** The QR's version, machine and meeting fields: the relay's where it carries the pairing, the local network's where it is on. */
export function qrPlace(
  place: Meeting,
  relayUrl: string,
): Pick<QrPayload, 'v' | 'machineId' | 'relayUrl' | 'pairingToken' | 'lan'> {
  const { lan, relay } = place;
  const near =
    lan === null
      ? {}
      : { lan: { hosts: lan.hosts, port: lan.port, instance: lan.instance } };
  if (relay === null)
    return { v: QR_VERSION.LAN_ONLY, machineId: lan?.machineId ?? '', ...near };
  const { account, opened } = relay;
  const { pairingToken } = opened;
  return {
    v: QR_VERSION.RELAY,
    machineId: account.machineId,
    relayUrl,
    pairingToken,
    ...near,
  };
}

/** The phone once it finished the handshake and proved its key, with the digits both screens show. */
export interface PhoneHello {
  name: string;
  /** A phone, or a Mac pairing over the relay; anything else a device says is read as a phone. */
  kind: RemoteDeviceKind;
  signingPoint: string;
  noiseStatic: string;
  fingerprint: string;
  code: string;
}

const LONGEST_DEVICE_NAME = 64;

/** The kinds a device may pair as; the Mac's own entry is never paired, it follows its key. */
type RemoteDeviceKind = typeof DEVICE_KIND.PHONE | typeof DEVICE_KIND.DESKTOP;

export function pairingLink(payload: QrPayload): string {
  return `memnox://pair?d=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

interface ResponderDeps {
  noise: Noise;
  key: NoiseKeypair;
  secret: Buffer;
  machine: string;
  send: (payload: Buffer) => void;
  /** The handshake finished and the proof held, so the person can now compare digits. */
  answered: (hello: PhoneHello, channel: SecureChannel) => void;
  log: (message: string) => void;
}

const STAGE = {
  FIRST: 'first',
  THIRD: 'third',
  PROOF: 'proof',
  DONE: 'done',
  /** One handshake per secret: after a failure every frame for this pairing is dropped. */
  DEAD: 'dead',
} as const;

type Stage = (typeof STAGE)[keyof typeof STAGE];

export class PairingResponder {
  private stage: Stage = STAGE.FIRST;
  private handshake: NoiseHandshake | null = null;
  private channel: SecureChannel | null = null;
  private hello: Omit<PhoneHello, 'code' | 'fingerprint'> | null = null;
  private hash: Buffer | null = null;

  constructor(private readonly deps: ResponderDeps) {}

  /** Whether this pairing can still take a phone. */
  open(): boolean {
    return this.stage !== STAGE.DEAD && this.stage !== STAGE.DONE;
  }

  receive(payload: Buffer): void {
    const kind = payload[0];
    const body = payload.subarray(1);
    try {
      if (kind === FRAME.CLOSE) return this.die('the phone left the pairing');
      if (kind === FRAME.HANDSHAKE && this.stage === STAGE.FIRST) return this.first(body);
      if (kind === FRAME.HANDSHAKE && this.stage === STAGE.THIRD) return this.third(body);
      if (kind === FRAME.TRANSPORT && this.stage === STAGE.PROOF) return this.proof(body);
      this.deps.log(`a pairing frame arrived out of turn and was dropped`);
    } catch (err) {
      this.die(
        `a pairing handshake failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private first(body: Buffer): void {
    const handshake = this.deps.noise.respond(
      NOISE_PATTERN.XXPSK0,
      this.deps.key.privateKey,
      this.deps.secret,
    );
    handshake.readMessage(body);
    const reply = handshake.writeMessage(
      Buffer.from(JSON.stringify({ machine: this.deps.machine })),
    );
    this.handshake = handshake;
    this.stage = STAGE.THIRD;
    this.deps.send(frame(FRAME.HANDSHAKE, reply));
  }

  private third(body: Buffer): void {
    const handshake = this.handshake;
    if (handshake === null) return this.die('no handshake to finish');
    const said = parseHello(handshake.readMessage(body));
    const noiseStatic = handshake.remoteStatic();
    if (said === null || noiseStatic === null || !handshake.isFinished()) {
      return this.die('the phone sent no name or no signing key');
    }
    this.hash = handshake.handshakeHash();
    this.hello = { ...said, noiseStatic: noiseStatic.toString('base64') };
    this.channel = new SecureChannel(handshake.intoTransport());
    this.handshake = null;
    this.stage = STAGE.PROOF;
  }

  private proof(body: Buffer): void {
    const { channel, hello, hash } = this;
    if (channel === null || hello === null || hash === null)
      return this.die('no session');
    const line = channel.open(body);
    if (line === null) return;
    const proof = parseProof(line);
    if (
      proof === null ||
      !verifiesSigned(hello.signingPoint, deviceProofMessage(hash), proof)
    ) {
      return this.die('the phone could not prove it holds its signing key');
    }
    this.stage = STAGE.DONE;
    this.deps.answered(
      {
        ...hello,
        fingerprint: deviceFingerprint(hello.signingPoint, hello.noiseStatic),
        code: this.deps.noise.pairingCode(hash),
      },
      channel,
    );
  }

  private die(why: string): void {
    this.stage = STAGE.DEAD;
    this.handshake = null;
    this.deps.log(why);
  }
}

/** The device's third message: its name, its Secure Enclave point and its kind, or null for anything else. */
function parseHello(
  bytes: Buffer,
): { name: string; signingPoint: string; kind: RemoteDeviceKind } | null {
  const parsed = parseObject(bytes.toString('utf8'));
  const name = parsed?.['name'];
  const signingPoint = parsed?.['signingPoint'];
  if (typeof name !== 'string' || typeof signingPoint !== 'string') return null;
  const trimmed = name.trim().slice(0, LONGEST_DEVICE_NAME);
  const kind =
    parsed?.['kind'] === DEVICE_KIND.DESKTOP ? DEVICE_KIND.DESKTOP : DEVICE_KIND.PHONE;
  return trimmed === '' || !isP256Point(signingPoint)
    ? null
    : { name: trimmed, signingPoint, kind };
}

function parseProof(line: string): string | null {
  const proof = parseObject(line)?.['proof'];
  return typeof proof === 'string' ? proof : null;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    // Narrowed to a plain object here; each caller checks the fields it reads.
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
