import type { NoiseTransport } from './noise';

/**
 * How bytes sit inside a relay mailbox: one kind byte, then a handshake message, a transport
 * message or nothing. A transport plaintext is a chunk flag and up to 65000 bytes of one JSON line.
 */

export const FRAME = {
  HANDSHAKE: 0x01,
  TRANSPORT: 0x02,
  /** The sender drops its session. */
  CLOSE: 0x03,
} as const;

/** A relay mailbox id is 16 random bytes, ahead of every payload on the socket. */
export const MAILBOX_BYTES = 16;

/** The whole of one message the relay takes: mailbox and payload. */
export const MOST_RELAY_MESSAGE = 65_552;

const LAST_CHUNK = 0x00;
const MORE_CHUNKS = 0x01;
const CHUNK_TEXT = 65_000;

/** A line longer than this is not a request anybody sends, so it ends the session rather than filling memory. */
const MOST_LINE_BYTES = 4 * 1024 * 1024;

/** Each direction asks snow for a new key after this many messages, as the contract sets it. */
const REKEY_EVERY = 1_048_576;

export function frame(kind: number, body: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from([kind]), body]);
}

/** A finished Noise session carrying JSON lines, counting messages so each side rekeys on the same one. */
export class SecureChannel {
  private sent = 0;
  private received = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;

  constructor(
    private readonly transport: NoiseTransport,
    private readonly rekeyEvery: number = REKEY_EVERY,
  ) {}

  /** One line, without its newline, as however many transport frames it takes. */
  seal(line: string): Buffer[] {
    const bytes = Buffer.from(line.endsWith('\n') ? line.slice(0, -1) : line, 'utf8');
    const frames: Buffer[] = [];
    for (let at = 0; at < bytes.length || frames.length === 0; at += CHUNK_TEXT) {
      const last = at + CHUNK_TEXT >= bytes.length;
      const flag = Buffer.from([last ? LAST_CHUNK : MORE_CHUNKS]);
      const plain = Buffer.concat([flag, bytes.subarray(at, at + CHUNK_TEXT)]);
      frames.push(frame(FRAME.TRANSPORT, this.transport.encrypt(plain)));
      this.sent += 1;
      if (this.sent % this.rekeyEvery === 0) this.transport.rekeyOutgoing();
    }
    return frames;
  }

  /** The line a transport message completes, null while more chunks are due; throws on a forged message. */
  open(ciphertext: Buffer): string | null {
    const plain = this.transport.decrypt(ciphertext);
    this.received += 1;
    if (this.received % this.rekeyEvery === 0) this.transport.rekeyIncoming();
    this.pending.push(plain.subarray(1));
    this.pendingBytes += plain.length - 1;
    if (this.pendingBytes > MOST_LINE_BYTES) throw new Error('a line past any request');
    if (plain[0] !== LAST_CHUNK) return null;
    const line = Buffer.concat(this.pending).toString('utf8');
    this.pending = [];
    this.pendingBytes = 0;
    return line;
  }

  /** How many messages each way, so a test can watch the rekey land where the contract says. */
  counts(): { sent: number; received: number } {
    return { sent: this.sent, received: this.received };
  }
}
