import { hostname } from 'node:os';
import {
  DAEMON_EVENT,
  DAEMON_METHOD,
  DEVICE_KIND,
  Devices,
  deviceWire,
  grantMessage,
  holds,
  isRemoteCapability,
  PER_SUBJECT,
  REMOTE_CAPABILITY,
  REMOTE_METHOD,
  REMOTE_OUTCOME,
  remoteCapabilityFor,
  THIS_MAC,
  UNNAMED_AGENT,
  verifiesSigned,
  type Account,
  type DaemonEvent,
  type DaemonRequest,
  type DaemonResponse,
  type DeviceRecord,
  type DrivenBy,
} from '@memnox/core';
import { CLI_VERSION } from '../defaults';
import type { RemotePrincipal } from '../daemon/confirm';
import { kokoroAnswers } from '../daemon/kokoro-speech';
import { write, type Peer } from '../daemon/socket-write';
import { WaitingFeed } from '../daemon/waiting-feed';
import type { HeartbeatBeats } from '../sync/beat';
import { cloudRelay, type RelayCloud } from '../sync/relay';
import { defaultBaseUrl } from '../sync/cloud-url';
import { ensureDeviceSpace, relayMachine, spaceBaseUrl } from '../sync/device-space';
import { DriveGrants, driveRefusal } from './drive';
import { loadNoise, type Noise } from './noise';
import { PairingBook, refused } from './pairings';
import { keepVoice, readVoice, runtimeNoiseKey } from './remote-files';
import { RelayLink, relayUrl, type OpenRelay } from './relay-link';
import { RemoteSession } from './remote-session';
import type { VoiceHold } from './voice-hold';
import { PhoneWakes } from './wake';

/**
 * Where the phone's tunnel ends: the relay link, the pairings, each paired phone's session, and
 * the capability check every remote request passes before the voice surface sees it.
 */

/** Often enough that a phone is woken while its person can still answer. */
const WAKE_INTERVAL_MS = 5_000;

/**
 * An open phone asks for its sessions every few seconds, and the relay never says when iOS suspended
 * it, so a session this long without a frame is a phone gone: its stream would otherwise hold the
 * voice off the Mac, and keep the phone from being woken, until the relay itself dropped.
 */
export const SILENT_PHONE_MS = 90_000;

/** What the endpoint needs of the voice surface, so neither builds the other. */
export interface RemoteVoice {
  respond(peer: Peer, request: DaemonRequest, principal?: RemotePrincipal): Promise<void>;
  broadcast(event: DaemonEvent): void;
  /** Which phone holds the voice, and whose app follows events: a revoked phone holds and follows nothing. */
  readonly hold: Pick<VoiceHold, 'driven' | 'forget' | 'released' | 'listening'>;
  drop(peer: Peer): void;
}

export interface RemoteDeps {
  home: string;
  now: () => string;
  log: (message: string) => void;
  voice: () => RemoteVoice | null;
  noise?: () => Noise;
  cloud?: RelayCloud;
  openRelay?: OpenRelay;
  account?: () => Promise<Account | null>;
  rekeyEvery?: number;
  wakeIntervalMs?: number;
  /** Whether a Kokoro voice answers on this machine; a test hands in its own. */
  speaks?: () => Promise<boolean>;
  /** Where a beat from the control plane goes, so the sync loop beats at once rather than polling. */
  beats?: HeartbeatBeats;
}

const REMOTE_METHODS: readonly string[] = Object.values(REMOTE_METHOD);

/** Pairing, the devices, the voice and driving, which the remote endpoint answers rather than the voice. */
export function isRemoteMethod(method: string): boolean {
  return REMOTE_METHODS.includes(method);
}

export class RemoteEndpoint {
  readonly pairings: PairingBook;
  readonly drives: DriveGrants;
  private link: RelayLink | null = null;
  private readonly sessions = new Map<string, RemoteSession>();
  /** When each mailbox last carried a frame from its device. */
  private readonly heardAt = new Map<string, string>();
  private readonly wakes = new PhoneWakes();
  private wakeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: RemoteDeps) {
    deps.beats?.linkedBy(() => this.link?.isUp() ?? false);
    this.drives = new DriveGrants(deps.now, (drivenBy) => this.drivenChanged(drivenBy));
    this.pairings = new PairingBook({
      home: deps.home,
      now: deps.now,
      noise: () => this.noise(),
      // Pairing is the one need that registers this Mac's personal space, so a phone pairs with no account.
      account: () => this.account(true),
      cloud: this.cloud(),
      relayUrl: relayUrl(),
      machineName: () => hostname().replace(/\.local$/, ''),
      connect: () => void this.connect(),
      send: (mailbox, payload) => this.link?.send(mailbox, payload) ?? false,
      speaks: () => this.speaks(),
      log: deps.log,
    });
  }

  /** On only once sync is enrolled and a device is paired, so nothing changes for a Mac with no phone. */
  async start(): Promise<void> {
    if ((await this.paired()).length > 0) await this.connect();
  }

  close(): void {
    for (const session of this.sessions.values()) session.end('the daemon stopped');
    this.sessions.clear();
    this.link?.stop();
    this.link = null;
    if (this.wakeTimer !== null) clearInterval(this.wakeTimer);
    this.wakeTimer = null;
    this.pairings.close();
    this.drives.close();
  }

  /** The local socket's side: pairing and the devices are the Mac's alone. */
  async respondLocal(peer: Peer, request: DaemonRequest): Promise<void> {
    if (request.method === DAEMON_METHOD.PAIR_PENDING)
      return this.pairings.pending(peer, request);
    write(peer, await this.answerLocal(request));
  }

  /** One line to a device's live session, false when it has none open. */
  tell(deviceId: string, response: DaemonResponse): boolean {
    const session = this.sessionOf(deviceId);
    if (session === null) return false;
    write(session, response);
    return true;
  }

  driving(deviceId: string): boolean {
    return this.drives.driving(deviceId);
  }

  /** A frame from the relay: a pairing's while one waits on that mailbox, else a paired phone's session. */
  receive(mailbox: string, payload: Buffer): void {
    const pairing = this.pairings.forMailbox(mailbox);
    if (pairing !== null) return pairing.receive(payload);
    this.heardAt.set(mailbox, this.deps.now());
    void this.sessionFor(mailbox).then((session) => session.receive(payload));
  }

  /** A remote request, allowed only by what the device its handshake proved may do. */
  async dispatch(session: RemoteSession, request: DaemonRequest): Promise<void> {
    const device =
      session.device === null
        ? null
        : await new Devices(this.deps.home).find(session.device.id);
    if (device === null || device.revokedAt !== undefined) return session.destroy();
    const needs = remoteCapabilityFor(request.method, request.voice);
    if (needs === null || (needs !== PER_SUBJECT && !holds(device, needs))) {
      return write(session, refused(request, `${device.name} may not do that from afar`));
    }
    // The origin is the session's device, whatever the phone wrote.
    const { origin: _ignored, ...asked } = request;
    if (request.method === DAEMON_METHOD.PING) {
      return write(session, {
        id: request.id,
        ok: true,
        version: CLI_VERSION,
        speaks: await this.speaks(),
        capabilities: [...device.capabilities],
      });
    }
    if (request.method === DAEMON_METHOD.VOICE_CHOICE) {
      return write(session, {
        id: request.id,
        ok: true,
        voice: await readVoice(this.deps.home),
      });
    }
    if (request.method === DAEMON_METHOD.DRIVE)
      return write(session, this.drive(device, request));
    if (request.method === DAEMON_METHOD.VOICE_RELEASE) {
      this.deps.voice()?.hold.released(device.id);
      return write(session, { id: request.id, ok: true });
    }
    const principal = { device, driving: this.drives.driving(device.id) };
    await this.deps.voice()?.respond(session, asked, principal);
  }

  private async answerLocal(request: DaemonRequest): Promise<DaemonResponse> {
    const method = request.method;
    if (method === DAEMON_METHOD.PAIR_BEGIN)
      return this.pairings
        .begin(request)
        .catch((err: unknown) => refused(request, String(err)));
    if (method === DAEMON_METHOD.PAIR_ACCEPT) return this.pairings.accept(request);
    if (method === DAEMON_METHOD.PAIR_DECLINE) return this.pairings.decline(request);
    if (method === DAEMON_METHOD.DEVICES_LIST) {
      const devices = await new Devices(this.deps.home).all();
      return { id: request.id, ok: true, devices: devices.map(deviceWire) };
    }
    if (method === DAEMON_METHOD.DEVICE_REVOKE) return this.revoke(request);
    if (method === DAEMON_METHOD.DEVICE_GRANT) return this.grant(request);
    if (method === DAEMON_METHOD.DEVICE_UNGRANT) return this.ungrant(request);
    if (method === DAEMON_METHOD.VOICE_CHOICE) return this.voiceChoice(request);
    return refused(
      request,
      'Driving the Mac and letting its voice go come from a paired phone, never from this socket.',
    );
  }

  /** Taken away at once: its live session closes, its grant ends, and the cloud closes its mailbox. */
  private async revoke(request: DaemonRequest): Promise<DaemonResponse> {
    const revoked = await new Devices(this.deps.home).revoke(
      request.deviceId ?? '',
      this.deps.now(),
    );
    if (revoked === null) return refused(request, 'No paired phone has that id.');
    for (const session of this.sessions.values()) {
      if (session.device?.id === revoked.id) session.destroy();
    }
    this.drives.stop(revoked.id);
    this.deps.voice()?.hold.forget(revoked.id);
    const account = await this.account();
    if (account !== null && revoked.mailbox !== undefined) {
      await this.cloud()
        .closeMailbox(account, revoked.mailbox)
        .catch(() => false);
    }
    return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.REVOKED };
  }

  /**
   * One more capability: with the Mac's own Touch ID over exactly that device and capability wherever
   * a Mac key is kept, and on the person's word at this socket on a machine with none, like a pairing.
   */
  private async grant(request: DaemonRequest): Promise<DaemonResponse> {
    const { deviceId, capability, signature } = request;
    if (
      deviceId === undefined ||
      capability === undefined ||
      !isRemoteCapability(capability)
    ) {
      return refused(request, 'device-grant needs a device and a capability it knows.');
    }
    const devices = new Devices(this.deps.home);
    const mac = await devices.find(THIS_MAC);
    const signed =
      mac === null ||
      (signature !== undefined &&
        verifiesSigned(mac.signingPoint, grantMessage(deviceId, capability), signature));
    if (!signed)
      return refused(request, "Giving a device more needs this Mac's Touch ID.");
    const granted = await devices.grant(deviceId, capability);
    if (granted === null) return refused(request, 'No paired device has that id.');
    return {
      id: request.id,
      ok: true,
      outcome: REMOTE_OUTCOME.GRANTED,
      device: deviceWire(granted),
    };
  }

  /** Taken back without a signature, since it only narrows; losing `mac` ends a live drive with it. */
  private async ungrant(request: DaemonRequest): Promise<DaemonResponse> {
    const { deviceId, capability } = request;
    if (
      deviceId === undefined ||
      capability === undefined ||
      !isRemoteCapability(capability)
    ) {
      return refused(request, 'device-ungrant needs a device and a capability it knows.');
    }
    const ungranted = await new Devices(this.deps.home).ungrant(deviceId, capability);
    if (ungranted === null) return refused(request, 'No paired phone has that id.');
    if (capability === REMOTE_CAPABILITY.MAC) this.drives.stop(ungranted.id);
    return {
      id: request.id,
      ok: true,
      outcome: REMOTE_OUTCOME.UNGRANTED,
      device: deviceWire(ungranted),
    };
  }

  private async voiceChoice(request: DaemonRequest): Promise<DaemonResponse> {
    const home = this.deps.home;
    if (
      request.voice !== undefined &&
      !(await keepVoice(home, request.voice, this.deps.now()))
    ) {
      return refused(request, `${request.voice} is not a Kokoro voice id.`);
    }
    return { id: request.id, ok: true, voice: await readVoice(home) };
  }

  private drive(device: DeviceRecord, request: DaemonRequest): DaemonResponse {
    if (request.until === undefined) {
      this.drives.stop(device.id);
      return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.STOPPED };
    }
    const until = request.until;
    const why = driveRefusal(
      device,
      {
        until,
        ...(request.signature === undefined ? {} : { signature: request.signature }),
      },
      this.deps.now(),
    );
    if (why !== null) return refused(request, why);
    this.drives.start(device, until);
    return { id: request.id, ok: true, outcome: REMOTE_OUTCOME.DRIVING, until };
  }

  /** The Mac island shows who drives it for the whole grant; the same notice with no until is the one stop signal. */
  private drivenChanged(drivenBy: DrivenBy): void {
    const { name, until } = drivenBy;
    const event: DaemonEvent = {
      kind: DAEMON_EVENT.NOTICE,
      subject: `drive_${drivenBy.deviceId}`,
      agent: UNNAMED_AGENT,
      summary:
        until === undefined ? `No longer driven from ${name}` : `Driven from ${name}`,
      at: this.deps.now(),
      ...(until === undefined ? {} : { expiresAt: until }),
      drivenBy,
    };
    this.deps.voice()?.hold.driven(drivenBy);
    this.deps.voice()?.broadcast(event);
  }

  private async connect(): Promise<void> {
    if (this.link !== null) return;
    const account = await this.account();
    if (account === null || account.revokedAt !== undefined) return;
    await runtimeNoiseKey(this.deps.home, this.noise());
    this.link = new RelayLink({
      url: relayUrl(),
      token: account.token,
      onFrame: (mailbox, payload) => this.receive(mailbox, payload),
      onBeat: () => this.deps.beats?.beat(),
      onDown: () => this.relayDown(),
      log: this.deps.log,
      ...(this.deps.openRelay === undefined ? {} : { open: this.deps.openRelay }),
    });
    this.link.start();
    this.watchWaiting();
  }

  private relayDown(): void {
    for (const session of this.sessions.values()) session.end('the relay dropped');
  }

  private async sessionFor(mailbox: string): Promise<RemoteSession> {
    const found = this.sessions.get(mailbox);
    if (found !== undefined) return found;
    const session = new RemoteSession({
      mailbox,
      noise: this.noise(),
      key: await runtimeNoiseKey(this.deps.home, this.noise()),
      send: (payload) => void this.link?.send(mailbox, payload),
      deviceFor: (noiseStatic) => new Devices(this.deps.home).byNoiseStatic(noiseStatic),
      dispatch: (each, request) => this.dispatch(each, request),
      opened: (each) => this.deps.log(`${each.device?.name ?? 'a phone'} connected`),
      closed: (each) => this.sessionClosed(each),
      log: this.deps.log,
      ...(this.deps.rekeyEvery === undefined ? {} : { rekeyEvery: this.deps.rekeyEvery }),
    });
    this.sessions.set(mailbox, session);
    return session;
  }

  /** A dropped session ends that phone's drive and its subscription, whose end starts the voice's grace. */
  private sessionClosed(session: RemoteSession): void {
    if (session.device !== null) this.drives.stop(session.device.id);
    this.deps.voice()?.drop(session);
  }

  private sessionOf(deviceId: string): RemoteSession | null {
    for (const session of this.sessions.values()) {
      if (!session.destroyed && session.device?.id === deviceId) return session;
    }
    return null;
  }

  /** Wakes a phone whose app follows no events when something new waits on its person. */
  private watchWaiting(): void {
    if (this.wakeTimer !== null) return;
    const feed = new WaitingFeed(this.deps.home);
    this.wakeTimer = setInterval(() => {
      // First, so a phone gone quiet counts as closed and is woken in the same pass.
      this.endSilent();
      void this.wakePhones(feed).catch((err: unknown) =>
        this.deps.log(`could not wake a phone: ${String(err)}`),
      );
    }, this.deps.wakeIntervalMs ?? WAKE_INTERVAL_MS);
    this.wakeTimer.unref();
  }

  /** Closes each phone session silent past the limit, telling the phone so one only quiet opens afresh; how many. */
  endSilent(moment: string = this.deps.now()): number {
    let ended = 0;
    for (const session of this.sessions.values()) {
      if (session.destroyed || session.device?.kind !== DEVICE_KIND.PHONE) continue;
      const heard = this.heardAt.get(session.mailbox);
      if (heard !== undefined && Date.parse(moment) - Date.parse(heard) < SILENT_PHONE_MS)
        continue;
      this.deps.log(`${session.device.name} went quiet, so its session is closed`);
      session.destroy();
      ended += 1;
    }
    return ended;
  }

  /** One pass of the wake check, public so a test runs it without a timer. */
  async wakePhones(feed: WaitingFeed = new WaitingFeed(this.deps.home)): Promise<number> {
    const account = await this.account();
    if (account === null) return 0;
    const waiting = (await feed.current(this.deps.now())).map((event) => event.subject);
    const due = this.wakes.due(waiting, await this.phones(), {
      // A tunnel open for a turn asked from the island carries no events, so only a following app counts.
      live: (deviceId) =>
        this.sessionOf(deviceId) !== null &&
        (this.deps.voice()?.hold.listening(deviceId) ?? false),
      now: Date.parse(this.deps.now()),
    });
    for (const phone of due) {
      if (phone.mailbox !== undefined)
        await this.cloud().wakePhone(account, phone.mailbox);
    }
    return due.length;
  }

  /** Only phones are woken, since a Mac on the relay keeps its own connection while it is awake. */
  private async phones(): Promise<DeviceRecord[]> {
    return (await this.paired()).filter((each) => each.kind === DEVICE_KIND.PHONE);
  }

  /** Every live device that reaches this machine through the relay, phones and Macs alike. */
  private async paired(): Promise<DeviceRecord[]> {
    const account = await this.account();
    if (account === null || account.revokedAt !== undefined) return [];
    const devices = await new Devices(this.deps.home).all();
    return devices.filter(
      (each) => each.kind !== DEVICE_KIND.MAC && each.revokedAt === undefined,
    );
  }

  private speaks(): Promise<boolean> {
    return this.deps.speaks?.() ?? kokoroAnswers();
  }

  /** The account's machine, else this Mac's personal space, which the relay carries a phone to just the same. */
  private account(create = false): Promise<Account | null> {
    if (this.deps.account !== undefined) return this.deps.account();
    const home = this.deps.home;
    return relayMachine(
      home,
      create
        ? async () => ensureDeviceSpace(home, await spaceBaseUrl(home, defaultBaseUrl()))
        : null,
    );
  }

  private noise(): Noise {
    return this.deps.noise?.() ?? loadNoise();
  }

  private cloud(): RelayCloud {
    return this.deps.cloud ?? cloudRelay;
  }
}
