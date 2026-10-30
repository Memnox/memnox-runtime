import type { NetworkInterfaceInfo } from 'node:os';
import { MAILBOX_BYTES, MOST_RELAY_MESSAGE } from './framing';

/**
 * How relay messages travel over a local TCP connection: each one is the very bytes the relay
 * carries, a mailbox and a payload, behind a four byte big endian length. Nothing new is said.
 */

const LENGTH_BYTES = 4;

/** One relay message as it goes down a local connection. */
export function lanFrame(mailbox: string, payload: Buffer): Buffer | null {
  const id = Buffer.from(mailbox, 'base64url');
  if (id.length !== MAILBOX_BYTES) return null;
  const length = MAILBOX_BYTES + payload.length;
  if (length > MOST_RELAY_MESSAGE) return null;
  const head = Buffer.alloc(LENGTH_BYTES);
  head.writeUInt32BE(length);
  return Buffer.concat([head, id, payload]);
}

/** A message read off a local connection, split as the relay splits one. */
export interface LanMessage {
  mailbox: string;
  payload: Buffer;
}

/** Reads length prefixed messages as bytes arrive; a length past any relay message ends the connection. */
export class LanFrameReader {
  private pending = Buffer.alloc(0);
  /** Set once a length was out of bounds, after which the caller drops the connection. */
  broken = false;

  push(chunk: Buffer): LanMessage[] {
    if (this.broken) return [];
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: LanMessage[] = [];
    while (this.pending.length >= LENGTH_BYTES) {
      const length = this.pending.readUInt32BE(0);
      if (length <= MAILBOX_BYTES || length > MOST_RELAY_MESSAGE) {
        this.broken = true;
        this.pending = Buffer.alloc(0);
        return messages;
      }
      if (this.pending.length < LENGTH_BYTES + length) break;
      const body = this.pending.subarray(LENGTH_BYTES, LENGTH_BYTES + length);
      messages.push({
        mailbox: body.subarray(0, MAILBOX_BYTES).toString('base64url'),
        payload: Buffer.from(body.subarray(MAILBOX_BYTES)),
      });
      this.pending = this.pending.subarray(LENGTH_BYTES + length);
    }
    return messages;
  }
}

const MAPPED_PREFIX = '::ffff:';

/** RFC 1918 only: a public address, loopback or a link local one is never the local network here. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const plain = address.startsWith(MAPPED_PREFIX)
    ? address.slice(MAPPED_PREFIX.length)
    : address;
  const parts = plain.split('.').map(Number);
  if (parts.length !== 4 || parts.some((each) => !Number.isInteger(each))) return false;
  const [first = -1, second = -1] = parts;
  if (first === 10) return true;
  if (first === 172) return second >= 16 && second <= 31;
  return first === 192 && second === 168;
}

/** This machine's private IPv4 addresses, the only ones a listener binds to. */
export function privateAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const found = new Set<string>();
  for (const each of Object.values(interfaces)) {
    for (const info of each ?? []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateAddress(info.address))
        found.add(info.address);
    }
  }
  return [...found].sort();
}
