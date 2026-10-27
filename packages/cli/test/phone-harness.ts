import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { Account } from '@memnox/core';
import { FRAME, frame, MAILBOX_BYTES, SecureChannel } from '../src/remote/framing';
import { loadNoise, NOISE_PATTERN, type NoiseHandshake } from '../src/remote/noise';
import type { OpenRelay, RelaySocket } from '../src/remote/relay-link';
import type { RelayCloud } from '../src/sync/relay';

/**
 * A phone, a relay and a cloud that live in memory, so the tunnel is tested end to end with the real
 * snow addon and real P-256 keys, and no socket is ever opened.
 */

export const ACCOUNT: Account = {
  version: 1,
  baseUrl: 'https://api.memnox.test',
  workspaceId: 'ws_1',
  machineId: 'mac_1',
  token: 'mch_test',
  privateKey: 'unused',
  enrolledAt: '2026-10-01T00:00:00.000Z',
};

export const MAILBOX = Buffer.alloc(MAILBOX_BYTES, 7).toString('base64url');

/** A P-256 key as the Secure Enclave holds one: the X9.63 point out, signatures in DER. */
export interface PersonKey {
  point: string;
  signs: (message: string) => string;
}

export function personKey(): PersonKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    point: spki.subarray(spki.length - 65).toString('base64'),
    signs: (message) => signWith(privateKey, message),
  };
}

function signWith(key: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message), key).toString('base64');
}

/** The relay's machine side: every message the runtime sent, and a way to hand it one. */
export class MemoryRelay {
  readonly sent: Buffer[] = [];
  /** True once the runtime's link is open, which it learns a turn after connecting. */
  up = false;
  private readonly listeners = new Map<string, (data: Buffer) => void>();
  opened = 0;

  readonly open: OpenRelay = () => {
    this.opened += 1;
    const socket: RelaySocket = {
      send: (data) => void this.sent.push(Buffer.from(data)),
      close: () => this.listeners.get('close')?.(Buffer.alloc(0)),
      on: (event: string, listener: (data: Buffer) => void) => {
        this.listeners.set(event, listener);
        if (event === 'open')
          queueMicrotask(() => {
            this.up = true;
            listener(Buffer.alloc(0));
          });
      },
    };
    return socket;
  };

  deliver(mailbox: string, payload: Buffer): void {
    this.listeners.get('message')?.(
      Buffer.concat([Buffer.from(mailbox, 'base64url'), payload]),
    );
  }

  drop(): void {
    this.up = false;
    this.listeners.get('close')?.(Buffer.alloc(0));
  }

  /** Payloads sent to a mailbox, its id taken off. */
  payloads(mailbox: string): Buffer[] {
    const id = Buffer.from(mailbox, 'base64url');
    return this.sent
      .filter((each) => each.subarray(0, MAILBOX_BYTES).equals(id))
      .map((each) => each.subarray(MAILBOX_BYTES));
  }
}

/** The cloud's relay routes, answering from memory and keeping what it was asked. */
export function memoryCloud(): RelayCloud & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openMailbox: async () => {
      calls.push('open');
      return {
        mailbox: MAILBOX,
        pairingToken: 'rlp_test',
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
    },
    mintPhoneToken: async (_account, mailbox) => {
      calls.push(`mint ${mailbox}`);
      return { tokenId: 'tok_1', token: 'rly_test' };
    },
    closeMailbox: async (_account, mailbox) => {
      calls.push(`close ${mailbox}`);
      return true;
    },
    wakePhone: async (_account, mailbox) => {
      calls.push(`wake ${mailbox}`);
      return true;
    },
  };
}

/** A phone: its Secure Enclave key, its Noise key, and the session it holds once a handshake ends. */
export class Phone {
  readonly key = personKey();
  readonly noise = loadNoise().generateKeypair();
  channel: SecureChannel | null = null;
  hash: Buffer | null = null;
  private handshake: NoiseHandshake | null = null;

  constructor(private readonly relay: MemoryRelay) {}

  /** Message one of a pairing, with the QR's secret. */
  startPairing(secret: Buffer): void {
    this.handshake = loadNoise().initiate(NOISE_PATTERN.XXPSK0, this.noise.privateKey, {
      psk: secret,
    });
    this.relay.deliver(
      MAILBOX,
      frame(FRAME.HANDSHAKE, this.handshake.writeMessage(Buffer.alloc(0))),
    );
  }

  /** Reads message two, sends message three and the proof; answers what the runtime said it is. */
  finishPairing(
    reply: Buffer,
    name = 'iPhone',
    kind?: string,
  ): { machine: string; runtimeStatic: Buffer | null } {
    const handshake = this.handshake;
    if (handshake === null) throw new Error('no pairing started');
    const said = JSON.parse(handshake.readMessage(reply.subarray(1)).toString()) as {
      machine: string;
    };
    const third = handshake.writeMessage(
      Buffer.from(JSON.stringify({ name, signingPoint: this.key.point, kind })),
    );
    const runtimeStatic = handshake.remoteStatic();
    this.relay.deliver(MAILBOX, frame(FRAME.HANDSHAKE, third));
    this.hash = handshake.handshakeHash();
    this.channel = new SecureChannel(handshake.intoTransport());
    const proof = this.key.signs(`memnox-device:v1:${this.hash.toString('base64')}`);
    this.send({ proof });
    return { machine: said.machine, runtimeStatic };
  }

  /** Message one of an IK handshake against the runtime's key, signed by whichever Noise key is given. */
  startSession(runtimeStatic: Buffer, privateKey: Buffer = this.noise.privateKey): void {
    this.handshake = loadNoise().initiate(NOISE_PATTERN.IK, privateKey, {
      publicKey: runtimeStatic,
    });
    this.relay.deliver(
      MAILBOX,
      frame(FRAME.HANDSHAKE, this.handshake.writeMessage(Buffer.alloc(0))),
    );
  }

  finishSession(reply: Buffer): void {
    const handshake = this.handshake;
    if (handshake === null) throw new Error('no session started');
    handshake.readMessage(reply.subarray(1));
    this.channel = new SecureChannel(handshake.intoTransport());
  }

  send(line: unknown): void {
    if (this.channel === null) throw new Error('no session');
    for (const each of this.channel.seal(JSON.stringify(line)))
      this.relay.deliver(MAILBOX, each);
  }

  /** Every line the runtime sent this phone through its session, decrypted in order. */
  read(payloads: readonly Buffer[]): unknown[] {
    const channel = this.channel;
    if (channel === null) return [];
    return payloads
      .filter((each) => each[0] === FRAME.TRANSPORT)
      .map((each) => channel.open(each.subarray(1)))
      .filter((line): line is string => line !== null)
      .map((line) => JSON.parse(line) as unknown);
  }
}

/** Waits turns of the event loop until a check holds, never a wall clock; false when it never did. */
export async function settle(
  check: () => boolean = () => false,
  turns = 2_000,
): Promise<boolean> {
  for (let at = 0; at < turns; at += 1) {
    if (check()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return check();
}
