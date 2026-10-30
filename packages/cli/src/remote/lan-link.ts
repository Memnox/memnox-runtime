import { randomBytes } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { FRAME } from './framing';
import {
  LanFrameReader,
  isPrivateAddress,
  lanFrame,
  privateAddresses,
  type LanMessage,
} from './lan-frames';
import { MdnsAdvertiser, type MdnsService } from './mdns';

/**
 * This machine's listener on the local network, beside the relay link: the same relay messages
 * over TCP, bound to private addresses only, with a cap on connections and on handshakes so a
 * neighbour on the same network can neither fill memory nor grind keys.
 */

/** Tried first, so a phone that paired keeps finding the same port; any free one when it is taken. */
const LAN_PORT = 47_390;

/** Connections at once, and from one address, which a household of phones never reaches. */
const MOST_CONNECTIONS = 16;
const MOST_PER_ADDRESS = 4;
/** Handshakes one address may start a minute: a phone opens one an hour, a key grinder thousands. */
const HANDSHAKES_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
/** A connection that says nothing this long after it opened is not a phone. */
const FIRST_FRAME_MS = 10_000;
/** Longer than a phone's own silence limit, so its session ends first and says why. */
const IDLE_MS = 120_000;

/** The part of a TCP socket the link uses, so a test hands in a pipe instead of a network. */
export interface LanSocket {
  readonly remoteAddress: string | undefined;
  write(data: Buffer): void;
  destroy(): void;
  onData(listener: (chunk: Buffer) => void): void;
  onClose(listener: () => void): void;
}

export interface LanServer {
  close(): void;
}

/** Listens on one address, answering the port it took. */
export type ListenLan = (
  host: string,
  port: number,
  accept: (socket: LanSocket) => void,
) => Promise<{ port: number; server: LanServer }>;

/** One phone's connection, which carries its pairing or its session. */
export interface LanConnection {
  readonly id: string;
  readonly address: string;
  /** False once it closed, so the caller knows nothing went. */
  send(mailbox: string, payload: Buffer): boolean;
  close(): void;
}

/** Where the link listens now, as lan-status says it. */
interface LanLinkState {
  listening: boolean;
  addresses: string[];
  port?: number;
  advertised: boolean;
}

interface Advertiser {
  start(): Promise<void>;
  stop(): void;
}

export interface LanLinkDeps {
  /** The random name the machine is announced under, kept so a paired phone finds it again. */
  instance: string;
  onMessage: (connection: LanConnection, message: LanMessage) => void;
  onClosed: (connection: LanConnection) => void;
  log: (message: string) => void;
  listen?: ListenLan;
  addresses?: () => string[];
  advertise?: (service: MdnsService) => Advertiser;
  port?: number;
  /** Milliseconds, handed in so a test can walk the handshake limit without waiting. */
  now?: () => number;
}

export class LanLink {
  private servers: LanServer[] = [];
  private bound: string[] = [];
  private port: number | undefined;
  private advertiser: Advertiser | null = null;
  private advertised = false;
  private readonly connections = new Map<string, Live>();
  private readonly handshakes = new Map<string, number[]>();

  constructor(private readonly deps: LanLinkDeps) {}

  state(): LanLinkState {
    return {
      listening: this.servers.length > 0,
      addresses: [...this.bound],
      ...(this.port === undefined ? {} : { port: this.port }),
      advertised: this.advertised,
    };
  }

  async start(): Promise<void> {
    if (this.servers.length > 0) return;
    const addresses = (this.deps.addresses ?? defaultAddresses)();
    if (addresses.length === 0) {
      this.deps.log(
        'the local network is on, but this machine has no private address to listen on',
      );
      return;
    }
    for (const address of addresses) await this.listenOn(address);
    if (this.port === undefined) return;
    await this.announce({
      instance: this.deps.instance,
      port: this.port,
      addresses: this.bound,
    });
  }

  /** Every connection closed and the announcement withdrawn, at once. */
  stop(): void {
    this.advertiser?.stop();
    this.advertiser = null;
    this.advertised = false;
    for (const server of this.servers) server.close();
    this.servers = [];
    this.bound = [];
    this.port = undefined;
    for (const live of [...this.connections.values()]) live.close();
    this.handshakes.clear();
  }

  private async listenOn(address: string): Promise<void> {
    const listen = this.deps.listen ?? listenTcp;
    const wanted = this.port ?? this.deps.port ?? LAN_PORT;
    try {
      const opened = await listen(address, wanted, (socket) => this.accept(socket)).catch(
        (err: unknown) => {
          // The usual port is taken on the first address only; after that every address shares one.
          if (this.port !== undefined) throw err;
          return listen(address, 0, (socket) => this.accept(socket));
        },
      );
      this.port = opened.port;
      this.servers.push(opened.server);
      this.bound.push(address);
    } catch (err) {
      this.deps.log(`could not listen on ${address}: ${String(err)}`);
    }
  }

  private async announce(service: MdnsService): Promise<void> {
    const advertiser = (this.deps.advertise ?? ((each) => new MdnsAdvertiser(each)))(
      service,
    );
    try {
      await advertiser.start();
      this.advertiser = advertiser;
      this.advertised = true;
    } catch (err) {
      // A phone still reaches the address in its QR; only finding it again after a move is lost.
      this.deps.log(`could not announce on the local network: ${String(err)}`);
    }
  }

  /** Refused outright from a public address, past the caps, or once the link stopped. */
  private accept(socket: LanSocket): void {
    const address = socket.remoteAddress;
    if (this.servers.length === 0 || address === undefined || !isPrivateAddress(address))
      return socket.destroy();
    const fromThere = [...this.connections.values()].filter(
      (each) => each.address === address,
    );
    if (
      this.connections.size >= MOST_CONNECTIONS ||
      fromThere.length >= MOST_PER_ADDRESS
    ) {
      this.deps.log(`refused a local connection from ${address}: too many open`);
      return socket.destroy();
    }
    const live = new Live(socket, address, {
      message: (message) => this.receive(live, message),
      closed: () => this.closed(live),
    });
    this.connections.set(live.id, live);
  }

  private receive(live: Live, message: LanMessage): void {
    if (message.payload[0] === FRAME.HANDSHAKE && !this.mayHandshake(live.address)) {
      this.deps.log(
        `closed a local connection from ${live.address}: too many handshakes`,
      );
      return live.close();
    }
    this.deps.onMessage(live, message);
  }

  /** A sliding minute per address, shared by its connections, so reconnecting does not reset it. */
  private mayHandshake(address: string): boolean {
    const now = (this.deps.now ?? Date.now)();
    const recent = (this.handshakes.get(address) ?? []).filter(
      (at) => now - at < MINUTE_MS,
    );
    if (recent.length >= HANDSHAKES_PER_MINUTE) {
      this.handshakes.set(address, recent);
      return false;
    }
    this.handshakes.set(address, [...recent, now]);
    return true;
  }

  private closed(live: Live): void {
    if (!this.connections.delete(live.id)) return;
    this.deps.onClosed(live);
  }
}

/** One open connection, with its reader and its timers. */
class Live implements LanConnection {
  readonly id = `lan_${randomBytes(9).toString('base64url')}`;
  private readonly reader = new LanFrameReader();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private open = true;

  constructor(
    private readonly socket: LanSocket,
    readonly address: string,
    private readonly on: { message: (message: LanMessage) => void; closed: () => void },
  ) {
    this.wait(FIRST_FRAME_MS);
    socket.onData((chunk) => this.data(chunk));
    socket.onClose(() => this.close());
  }

  send(mailbox: string, payload: Buffer): boolean {
    const bytes = lanFrame(mailbox, payload);
    if (!this.open || bytes === null) return false;
    this.socket.write(bytes);
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.socket.destroy();
    this.on.closed();
  }

  private data(chunk: Buffer): void {
    if (!this.open) return;
    const messages = this.reader.push(chunk);
    // A length out of bounds is not a phone talking, so nothing more is read from it.
    if (this.reader.broken) return this.close();
    if (messages.length > 0) this.wait(IDLE_MS);
    for (const message of messages) {
      if (!this.open) return;
      this.on.message(message);
    }
  }

  private wait(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close(), ms);
    // A quiet neighbour is never a reason to keep a daemon alive that was asked to stop.
    this.timer.unref();
  }
}

function defaultAddresses(): string[] {
  return privateAddresses(networkInterfaces());
}

function listenTcp(
  host: string,
  port: number,
  accept: (socket: LanSocket) => void,
): Promise<{ port: number; server: LanServer }> {
  const server = createServer((socket) => accept(wrapSocket(socket)));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.off('error', reject);
      const where = server.address();
      const taken = typeof where === 'object' && where !== null ? where.port : port;
      resolve({ port: taken, server: { close: () => server.close() } });
    });
  });
}

function wrapSocket(socket: Socket): LanSocket {
  socket.setNoDelay(true);
  // A phone that walked out of range resets the connection, which is a close and nothing worse.
  socket.on('error', () => socket.destroy());
  return {
    remoteAddress: socket.remoteAddress,
    write: (data) => void socket.write(data),
    destroy: () => socket.destroy(),
    onData: (listener) => socket.on('data', listener),
    onClose: (listener) => socket.on('close', listener),
  };
}
