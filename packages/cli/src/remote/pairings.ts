import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Devices,
  deviceWire,
  PAIR_APPROVER,
  PAIRING_STATE,
  pairMessage,
  PHONE_DEFAULT_CAPABILITIES,
  REMOTE_OUTCOME,
  THIS_MAC,
  verifiesSigned,
  type Account,
  type DaemonRequest,
  type DaemonResponse,
  type DeviceRecord,
  type PairApprover,
  type PairingState,
} from '@memnox/core';
import { write, type Peer } from '../daemon/socket-write';
import type { OpenedMailbox, RelayCloud } from '../sync/relay';
import { FRAME, frame, type SecureChannel } from './framing';
import type { Noise } from './noise';
import { pairingLink, PairingResponder, type PhoneHello } from './pairing';
import { readVoice, runtimeNoiseKey, type NoiseKeypair } from './remote-files';

/**
 * The pairings this machine has open: a mailbox from the cloud, a QR, a handshake, and the person's
 * yes. Where a Mac key is kept, `pair-accept` must carry its signature; on a machine with none, such
 * as a server reached over SSH, it must carry the six digits only the device's screen shows.
 */

/** How long the QR is good for when the cloud names no expiry, as long as its pairing token. */
const PAIRING_TTL_MS = 120_000;

/** Once a phone answered, the person has this long to compare digits and touch the sensor. */
const ANSWERED_TTL_MS = 5 * 60_000;

// Names no command, since the Mac app shows these words and connects the machine from its Account page.
const NOT_ENROLLED =
  'Memnox Cloud, which carries the device to this machine, could not be reached just now. Try again in a moment.';

/** Wrong digits a pairing takes before it closes, so the code cannot be guessed. */
const DIGIT_TRIES = 3;

interface Pairing {
  id: string;
  mailbox: string;
  expiresAt: string;
  state: PairingState;
  responder: PairingResponder;
  phone?: PhoneHello;
  channel?: SecureChannel;
  approver: PairApprover;
  wrongDigits: number;
  watchers: Map<Peer, number>;
  timer?: ReturnType<typeof setTimeout>;
}

interface PairingDeps {
  home: string;
  now: () => string;
  noise: () => Noise;
  account: () => Promise<Account | null>;
  cloud: RelayCloud;
  relayUrl: string;
  machineName: () => string;
  /** Opens the relay link, since the phone meets this machine there. */
  connect: () => void;
  send: (mailbox: string, payload: Buffer) => boolean;
  /** Whether this machine has a Kokoro voice to lend, so a device without one never asks. */
  speaks: () => Promise<boolean>;
  log: (message: string) => void;
}

export class PairingBook {
  private readonly pairings = new Map<string, Pairing>();

  constructor(private readonly deps: PairingDeps) {}

  /** The pairing still waiting on this mailbox, which takes its frames, or null. */
  forMailbox(mailbox: string): PairingResponder | null {
    for (const each of this.pairings.values()) {
      if (each.mailbox === mailbox && isLive(each.state)) return each.responder;
    }
    return null;
  }

  async begin(request: DaemonRequest): Promise<DaemonResponse> {
    const home = this.deps.home;
    const account = await this.deps.account();
    if (account === null || account.revokedAt !== undefined)
      return refused(request, NOT_ENROLLED);
    const approver = await approverOn(home);
    const noise = this.deps.noise();
    const key = await runtimeNoiseKey(home, noise);
    const opened = await this.deps.cloud.openMailbox(account);
    if (opened === null) {
      return refused(
        request,
        'Memnox Cloud could not open a mailbox for the device. Try again in a moment.',
      );
    }
    this.deps.connect();
    const machine = request.name?.trim() || this.deps.machineName();
    const pairing = this.open({ noise, key, opened, machine, approver });
    const qr = pairingLink({
      v: 1,
      machineId: account.machineId,
      machine,
      relayUrl: this.deps.relayUrl,
      mailbox: opened.mailbox,
      pairingToken: opened.pairingToken,
      runtimeNoiseStatic: key.publicKey.toString('base64'),
      secret: pairing.secret.toString('base64'),
      expiresAt: pairing.expiresAt,
    });
    return {
      id: request.id,
      ok: true,
      outcome: REMOTE_OUTCOME.PAIRING,
      pairing: { id: pairing.id, qr, expiresAt: pairing.expiresAt, approver },
    };
  }

  /** A pairing kept open on the cloud's mailbox, with a fresh secret good for one handshake. */
  private open(input: {
    noise: Noise;
    key: NoiseKeypair;
    opened: OpenedMailbox;
    machine: string;
    approver: PairApprover;
  }): { id: string; secret: Buffer; expiresAt: string } {
    const { noise, key, opened, machine, approver } = input;
    const id = `pair_${randomBytes(9).toString('base64url')}`;
    const secret = randomBytes(32);
    const expiresAt = expiryOf(opened.expiresAt, this.deps.now());
    const responder = new PairingResponder({
      noise,
      key,
      secret,
      machine,
      send: (payload) => void this.deps.send(opened.mailbox, payload),
      answered: (hello, channel) => this.answered(id, hello, channel),
      log: this.deps.log,
    });
    const state = PAIRING_STATE.WAITING;
    const mailbox = opened.mailbox;
    this.keep({
      id,
      mailbox,
      expiresAt,
      state,
      responder,
      approver,
      wrongDigits: 0,
      watchers: new Map(),
    });
    return { id, secret, expiresAt };
  }

  /** Where the pairing stands now, and again each time it changes, until it is over. */
  pending(peer: Peer, request: DaemonRequest): void {
    const pairing = this.pairings.get(request.pairingId ?? '');
    if (pairing === undefined) {
      write(peer, refused(request, 'That pairing is not open on this machine.'));
      return;
    }
    pairing.watchers.set(peer, request.id);
    this.tell(pairing);
  }

  async accept(request: DaemonRequest): Promise<DaemonResponse> {
    const pairing = this.pairings.get(request.pairingId ?? '');
    const { phone, channel } = pairing ?? {};
    if (
      pairing?.state !== PAIRING_STATE.ANSWERED ||
      phone === undefined ||
      channel === undefined
    ) {
      return refused(request, 'No device is waiting on that pairing.');
    }
    const approver = await approverOn(this.deps.home);
    const no = await this.refusal(request, pairing, approver);
    if (no !== null) return no;
    const account = await this.deps.account();
    const token =
      account === null
        ? null
        : await this.deps.cloud.mintPhoneToken(account, pairing.mailbox);
    if (token === null) {
      return refused(
        request,
        'Memnox Cloud could not give the device its token. Try again in a moment.',
      );
    }
    const device = deviceRecord(phone, {
      mailbox: pairing.mailbox,
      relayTokenId: token.tokenId,
      at: this.deps.now(),
      approvedBy: approver,
    });
    await new Devices(this.deps.home).add(device);
    await this.welcome(pairing, channel, {
      deviceId: device.id,
      relayToken: token.token,
    });
    this.settle(pairing, PAIRING_STATE.PAIRED);
    const wire = deviceWire(device);
    return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.PAIRED, device: wire };
  }

  /**
   * Why this yes does not hold, or null when it does. A Mac key registered since the pairing opened
   * is asked for all the same, since the stricter of the two always wins.
   */
  private async refusal(
    request: DaemonRequest,
    pairing: Pairing,
    approver: PairApprover,
  ): Promise<DaemonResponse | null> {
    const phone = pairing.phone;
    if (phone === undefined)
      return refused(request, 'No device is waiting on that pairing.');
    if (approver === PAIR_APPROVER.MAC_KEY) {
      return (await this.signedByMac(pairing.id, phone, request.signature))
        ? null
        : refused(request, "That approval was not signed with this Mac's Touch ID.");
    }
    return sameDigits(phone.code, request.code)
      ? null
      : this.wrongDigits(request, pairing);
  }

  /** A miss counts against the pairing, and the last allowed one closes it, so six digits cannot be walked. */
  private async wrongDigits(
    request: DaemonRequest,
    pairing: Pairing,
  ): Promise<DaemonResponse> {
    pairing.wrongDigits += 1;
    const left = DIGIT_TRIES - pairing.wrongDigits;
    if (left > 0) {
      const said = `Those digits are not the ones the device shows. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
      return { ...refused(request, said), triesLeft: left };
    }
    await this.decline(request);
    const closed =
      'Those digits were wrong three times, so the pairing is closed. Run memnox pair again.';
    return { ...refused(request, closed), triesLeft: 0 };
  }

  /** The device's one line once it is written: its id, its relay token and the voice picked here. */
  private async welcome(
    pairing: Pairing,
    channel: SecureChannel,
    paired: { deviceId: string; relayToken: string },
  ): Promise<void> {
    const voice = await readVoice(this.deps.home);
    const speaks = await this.deps.speaks();
    const line = JSON.stringify({ paired: true, ...paired, voice, speaks });
    for (const each of channel.seal(line)) this.deps.send(pairing.mailbox, each);
  }

  async decline(request: DaemonRequest): Promise<DaemonResponse> {
    const pairing = this.pairings.get(request.pairingId ?? '');
    if (pairing !== undefined && isLive(pairing.state)) {
      for (const each of pairing.channel?.seal(JSON.stringify({ paired: false })) ?? []) {
        this.deps.send(pairing.mailbox, each);
      }
      this.deps.send(pairing.mailbox, frame(FRAME.CLOSE));
      this.settle(pairing, PAIRING_STATE.DECLINED);
      await this.closeMailbox(pairing.mailbox);
    }
    return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.DECLINED };
  }

  close(): void {
    for (const each of this.pairings.values())
      if (each.timer !== undefined) clearTimeout(each.timer);
    this.pairings.clear();
  }

  private keep(pairing: Pairing): void {
    this.pairings.set(pairing.id, pairing);
    this.expireAt(pairing, pairing.expiresAt);
  }

  private answered(id: string, hello: PhoneHello, channel: SecureChannel): void {
    const pairing = this.pairings.get(id);
    if (pairing === undefined || pairing.state !== PAIRING_STATE.WAITING) return;
    pairing.state = PAIRING_STATE.ANSWERED;
    pairing.phone = hello;
    pairing.channel = channel;
    this.expireAt(
      pairing,
      new Date(Date.parse(this.deps.now()) + ANSWERED_TTL_MS).toISOString(),
    );
    this.tell(pairing);
  }

  private expireAt(pairing: Pairing, at: string): void {
    if (pairing.timer !== undefined) clearTimeout(pairing.timer);
    // No pairing outlives a person comparing digits, whatever expiry the cloud names.
    const wait = Math.min(
      Math.max(0, Date.parse(at) - Date.parse(this.deps.now())),
      ANSWERED_TTL_MS,
    );
    pairing.timer = setTimeout(() => {
      if (!isLive(pairing.state)) return;
      this.settle(pairing, PAIRING_STATE.EXPIRED);
      void this.closeMailbox(pairing.mailbox);
    }, wait);
    // An open QR is never a reason to keep a daemon alive that was asked to stop.
    pairing.timer.unref();
  }

  private settle(pairing: Pairing, state: PairingState): void {
    pairing.state = state;
    if (pairing.timer !== undefined) clearTimeout(pairing.timer);
    this.tell(pairing);
    pairing.watchers.clear();
  }

  private tell(pairing: Pairing): void {
    for (const [peer, id] of pairing.watchers) {
      write(peer, {
        id,
        ok: true,
        pairing: {
          id: pairing.id,
          state: pairing.state,
          approver: pairing.approver,
          ...(pairing.phone === undefined
            ? {}
            : {
                phone: {
                  name: pairing.phone.name,
                  fingerprint: pairing.phone.fingerprint,
                  // Typed to accept where no Mac key is kept, so then it is a secret only the device's screen holds.
                  ...(pairing.approver === PAIR_APPROVER.MAC_KEY
                    ? { code: pairing.phone.code }
                    : {}),
                },
              }),
        },
      });
    }
  }

  /** Only the Mac's own key signs a pairing, over this pairing and exactly the keys the phone proved. */
  private async signedByMac(
    id: string,
    phone: PhoneHello,
    signature?: string,
  ): Promise<boolean> {
    const mac = await new Devices(this.deps.home).find(THIS_MAC);
    if (mac === null || signature === undefined) return false;
    return verifiesSigned(
      mac.signingPoint,
      pairMessage(id, phone.fingerprint),
      signature,
    );
  }

  private async closeMailbox(mailbox: string): Promise<void> {
    const account = await this.deps.account();
    if (account !== null)
      await this.deps.cloud.closeMailbox(account, mailbox).catch(() => false);
  }
}

/** The Mac's Touch ID wherever its key is kept, and the person at a shell everywhere else. */
async function approverOn(home: string): Promise<PairApprover> {
  return (await new Devices(home).find(THIS_MAC)) === null
    ? PAIR_APPROVER.LOCAL_SHELL
    : PAIR_APPROVER.MAC_KEY;
}

function sameDigits(expected: string, typed: string | undefined): boolean {
  const given = Buffer.from((typed ?? '').replace(/\s/g, ''));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function isLive(state: PairingState): boolean {
  return state === PAIRING_STATE.WAITING || state === PAIRING_STATE.ANSWERED;
}

/** A no from the remote side, said in words the person can be told. */
export function refused(request: DaemonRequest, reason: string): DaemonResponse {
  return {
    id: request.id,
    ok: false,
    outcome: REMOTE_OUTCOME.REFUSED,
    reason,
    error: reason,
  };
}

/** The cloud's expiry when it gave a readable one, else the pairing token's own two minutes. */
function expiryOf(given: string, now: string): string {
  const at = Date.parse(given);
  return Number.isNaN(at)
    ? new Date(Date.parse(now) + PAIRING_TTL_MS).toISOString()
    : new Date(at).toISOString();
}

function deviceRecord(
  phone: PhoneHello,
  where: { mailbox: string; relayTokenId: string; at: string; approvedBy: PairApprover },
): DeviceRecord {
  return {
    id: `dev_${randomBytes(9).toString('base64url')}`,
    name: phone.name,
    kind: phone.kind,
    signingPoint: phone.signingPoint,
    noiseStatic: phone.noiseStatic,
    capabilities: [...PHONE_DEFAULT_CAPABILITIES],
    pairedAt: where.at,
    mailbox: where.mailbox,
    relayTokenId: where.relayTokenId,
    approvedBy: where.approvedBy,
  };
}
