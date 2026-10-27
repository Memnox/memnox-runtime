import { decodeRequest, type DaemonRequest, type DeviceRecord } from '@memnox/core';
import type { Peer } from '../daemon/socket-write';
import { FRAME, frame, SecureChannel } from './framing';
import { NOISE_PATTERN, type Noise } from './noise';
import type { NoiseKeypair } from './remote-files';

/**
 * One paired phone's tunnel through a mailbox: an IK handshake against a key in the registry,
 * then JSON lines both ways. A frame before a finished handshake, or from a key never paired, is dropped.
 */

interface SessionDeps {
  mailbox: string;
  noise: Noise;
  key: NoiseKeypair;
  send: (payload: Buffer) => void;
  /** The live device a handshake proved, or null for a key never paired or since revoked. */
  deviceFor: (noiseStatic: string) => Promise<DeviceRecord | null>;
  dispatch: (session: RemoteSession, request: DaemonRequest) => Promise<void>;
  opened: (session: RemoteSession) => void;
  closed: (session: RemoteSession) => void;
  log: (message: string) => void;
  rekeyEvery?: number;
}

export class RemoteSession implements Peer {
  destroyed = true;
  private current: DeviceRecord | null = null;
  private channel: SecureChannel | null = null;
  private handling: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SessionDeps) {}

  get mailbox(): string {
    return this.deps.mailbox;
  }

  /** The device its handshake proved; null until one finished. */
  get device(): DeviceRecord | null {
    return this.current;
  }

  /** Frames are handled in the order they came, since a handshake must finish before what follows it. */
  receive(payload: Buffer): void {
    this.handling = this.handling
      .then(() => this.handle(payload))
      .catch((err: unknown) => this.end(`a remote frame failed: ${String(err)}`));
  }

  write(line: string): void {
    if (this.destroyed || this.channel === null) return;
    for (const each of this.channel.seal(line)) this.deps.send(each);
  }

  /** Closed from this side: the phone is told, then the session is gone. */
  destroy(): void {
    if (this.destroyed) return;
    this.deps.send(frame(FRAME.CLOSE));
    this.end('closed by this machine');
  }

  /** The tunnel is gone without a word, such as the relay dropping. */
  end(why: string): void {
    const wasOpen = !this.destroyed;
    this.destroyed = true;
    this.channel = null;
    if (wasOpen) {
      this.deps.log(`${this.current?.name ?? 'a phone'} left: ${why}`);
      this.deps.closed(this);
    }
  }

  private async handle(payload: Buffer): Promise<void> {
    const kind = payload[0];
    const body = payload.subarray(1);
    if (kind === FRAME.HANDSHAKE) return this.handshake(body);
    if (kind === FRAME.CLOSE) return this.end('the phone closed its session');
    if (kind !== FRAME.TRANSPORT || this.channel === null) {
      this.deps.log('dropped a remote frame that came before its handshake finished');
      return;
    }
    const line = this.channel.open(body);
    if (line === null) return;
    const request = decodeRequest(line);
    if (request === null) return;
    // Not awaited, so a cancel is read while the answer it cancels is still streaming.
    void this.deps.dispatch(this, request).catch((err: unknown) => {
      this.deps.log(`a remote request failed: ${String(err)}`);
    });
  }

  /** A fresh IK handshake, the first or the phone's hourly one, which replaces whatever came before. */
  private async handshake(body: Buffer): Promise<void> {
    const responder = this.deps.noise.respond(NOISE_PATTERN.IK, this.deps.key.privateKey);
    try {
      responder.readMessage(body);
    } catch {
      this.deps.log('dropped a remote handshake that did not decrypt');
      return;
    }
    const remote = responder.remoteStatic();
    const device =
      remote === null ? null : await this.deps.deviceFor(remote.toString('base64'));
    if (device === null) {
      this.deps.log('dropped a remote handshake from a key this machine never paired');
      return;
    }
    if (this.current !== null && this.current.id !== device.id)
      this.end('another device took the mailbox');
    const reply = responder.writeMessage(Buffer.alloc(0));
    this.channel = new SecureChannel(responder.intoTransport(), this.deps.rekeyEvery);
    this.current = device;
    this.deps.send(frame(FRAME.HANDSHAKE, reply));
    if (this.destroyed) {
      this.destroyed = false;
      this.deps.opened(this);
    }
  }
}
