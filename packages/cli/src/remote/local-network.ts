import { DEVICE_KIND, readLanSetting, type LanStatus } from '@memnox/core';
import { lanIdentity, registerLan } from './lan-control';
import type { LanMessage } from './lan-frames';
import { LanLink, type LanConnection, type LanLinkDeps } from './lan-link';
import type { LanInvite, PairingResponder } from './pairing';
import type { RemoteSession } from './remote-session';

/**
 * The endpoint's local network half: the listener the person turned on, each connection's session,
 * and the pairings whose frames came that way. A session here is keyed by its connection, never by
 * the mailbox it writes, so nobody on the network can step into a session the relay carries.
 */

/** How the listener binds and announces, so a test opens no socket. */
export type LanSeams = Pick<
  LanLinkDeps,
  'listen' | 'addresses' | 'advertise' | 'port' | 'now'
>;

interface LocalNetworkDeps {
  home: string;
  log: (message: string) => void;
  seams?: LanSeams;
  pairingFor: (mailbox: string) => PairingResponder | null;
  /** The session under this key, made on its first frame with replies going through `send`. */
  session: (key: string, send: (payload: Buffer) => void) => Promise<RemoteSession>;
  existing: (key: string) => RemoteSession | undefined;
  heard: (key: string) => void;
  /** The connection is gone, so its session ends and is forgotten. */
  forget: (key: string, why: string) => void;
  /** The listener opened, so the silent phone check must run. */
  listening: () => void;
}

export class LocalNetwork {
  private link: LanLink | null = null;
  private readonly connections = new Map<string, LanConnection>();
  /** A pairing's mailbox whose frames came over the local network, so its replies go back the same way. */
  private readonly routes = new Map<string, LanConnection>();
  /** One change to the listener at a time, so a setting read twice never opens two. */
  private turn: Promise<void> = Promise.resolve();
  private unregister: (() => void) | null = null;

  constructor(private readonly deps: LocalNetworkDeps) {}

  /** Opens the listener where the person turned it on, and lets the lan methods reach it. */
  start(): Promise<void> {
    this.unregister ??= registerLan(this.deps.home, {
      status: () => this.status(),
      refresh: () => this.refresh(),
    });
    return this.refresh();
  }

  close(): void {
    this.stop();
    this.unregister?.();
    this.unregister = null;
  }

  /** Whether a session under this key came over the local network, which a relay drop leaves alone. */
  carries(key: string): boolean {
    return this.connections.has(key);
  }

  /** A pairing's reply down the connection it came on; null where it came by the relay. */
  route(mailbox: string, payload: Buffer): boolean | null {
    const local = this.routes.get(mailbox);
    return local === undefined ? null : local.send(mailbox, payload);
  }

  /** A local session closed from this side takes its connection with it. */
  closed(key: string): void {
    this.connections.get(key)?.close();
  }

  /** Opens or closes the listener to match the person's setting. */
  refresh(): Promise<void> {
    const turn = this.turn.then(() => this.match());
    this.turn = turn.catch((err: unknown) =>
      this.deps.log(`the local network did not change: ${String(err)}`),
    );
    return turn;
  }

  /** Where the local network listens, for a QR, or null while it is off or bound to nothing. */
  async invite(): Promise<LanInvite | null> {
    const state = this.link?.state();
    if (state === undefined || !state.listening || state.port === undefined) return null;
    const { instance, machineId } = await lanIdentity(this.deps.home);
    return { hosts: state.addresses, port: state.port, instance, machineId };
  }

  async status(): Promise<LanStatus> {
    const state = this.link?.state();
    const listening = state?.listening ?? false;
    return {
      on: await readLanSetting(this.deps.home),
      listening,
      addresses: state?.addresses ?? [],
      ...(state?.port === undefined ? {} : { port: state.port }),
      advertised: state?.advertised ?? false,
      ...(listening ? { instance: (await lanIdentity(this.deps.home)).instance } : {}),
      reachable: this.reachable(),
    };
  }

  private async match(): Promise<void> {
    if (!(await readLanSetting(this.deps.home))) return this.stop();
    if (this.link !== null) return;
    const { instance } = await lanIdentity(this.deps.home);
    const link = new LanLink({
      ...this.deps.seams,
      instance,
      onMessage: (connection, message) => this.message(connection, message),
      onClosed: (connection) => this.gone(connection),
      log: this.deps.log,
    });
    this.link = link;
    await link.start();
    this.deps.listening();
  }

  private stop(): void {
    const link = this.link;
    this.link = null;
    link?.stop();
    this.routes.clear();
  }

  /** A pairing's frame while one waits on its mailbox, else this connection's own session. */
  private message(connection: LanConnection, message: LanMessage): void {
    const pairing = this.deps.pairingFor(message.mailbox);
    if (pairing !== null) {
      this.routes.set(message.mailbox, connection);
      return pairing.receive(message.payload);
    }
    const key = connection.id;
    this.connections.set(key, connection);
    this.deps.heard(key);
    const send = (payload: Buffer): void =>
      void connection.send(message.mailbox, payload);
    void this.deps.session(key, send).then((session) => session.receive(message.payload));
  }

  private gone(connection: LanConnection): void {
    for (const [mailbox, routed] of this.routes) {
      if (routed === connection) this.routes.delete(mailbox);
    }
    if (!this.connections.delete(connection.id)) return;
    this.deps.forget(connection.id, 'the phone left the local network');
  }

  /** Paired phones with a live session over the local network now. */
  private reachable(): LanStatus['reachable'] {
    const found: LanStatus['reachable'] = [];
    for (const key of this.connections.keys()) {
      const session = this.deps.existing(key);
      const device = session?.device ?? null;
      if (session?.destroyed === false && device?.kind === DEVICE_KIND.PHONE)
        found.push({ deviceId: device.id, name: device.name });
    }
    return found;
  }
}
