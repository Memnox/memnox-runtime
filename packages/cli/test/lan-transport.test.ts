import { describe, expect, it } from 'vitest';
import { FRAME, frame, MAILBOX_BYTES, MOST_RELAY_MESSAGE } from '../src/remote/framing';
import {
  isPrivateAddress,
  LanFrameReader,
  lanFrame,
  privateAddresses,
} from '../src/remote/lan-frames';
import { LanLink, type LanSocket, type ListenLan } from '../src/remote/lan-link';
import {
  answersFor,
  encodeResponse,
  MdnsAdvertiser,
  MDNS_SERVICE,
  readQuery,
  serviceRecords,
  type MdnsSocket,
} from '../src/remote/mdns';

/** The local network transport with no socket bound: frames, Bonjour packets and the listener's limits. */

const MAILBOX = Buffer.alloc(MAILBOX_BYTES, 3).toString('base64url');

/** A DNS query for one name, as a phone's browser sends it. */
function query(name: string, type: number, id = 0): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(1, 4);
  const labels = name.split('.').map((label) => {
    const bytes = Buffer.from(label);
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([head, ...labels, Buffer.from([0]), tail]);
}

const PTR = 12;
const SERVICE = {
  instance: 'memnox-0a1b2c3d',
  port: 47_390,
  addresses: ['192.168.1.20'],
};

describe('local frames', () => {
  it('carries the relay message as it is, behind its length, and reads it back across chunks', () => {
    const payload = frame(FRAME.HANDSHAKE, Buffer.from('hello'));
    const bytes = lanFrame(MAILBOX, payload) ?? Buffer.alloc(0);
    const reader = new LanFrameReader();

    expect(reader.push(bytes.subarray(0, 7))).toEqual([]);
    const [message] = reader.push(bytes.subarray(7));
    expect(message?.mailbox).toBe(MAILBOX);
    expect(message?.payload.equals(payload)).toBe(true);
  });

  it('refuses a length past any relay message, and a mailbox that is not one', () => {
    const reader = new LanFrameReader();
    const head = Buffer.alloc(4);
    head.writeUInt32BE(MOST_RELAY_MESSAGE + 1);

    expect(reader.push(head)).toEqual([]);
    expect(reader.broken).toBe(true);
    expect(lanFrame('short', Buffer.alloc(1))).toBeNull();
    expect(lanFrame(MAILBOX, Buffer.alloc(MOST_RELAY_MESSAGE))).toBeNull();
  });

  it('counts only RFC 1918 addresses as the local network', () => {
    for (const address of [
      '10.0.0.4',
      '172.16.9.1',
      '172.31.0.1',
      '192.168.1.2',
      '::ffff:192.168.0.9',
    ])
      expect(isPrivateAddress(address)).toBe(true);
    for (const address of [
      '8.8.8.8',
      '172.32.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '::1',
      'fe80::1',
      undefined,
    ])
      expect(isPrivateAddress(address)).toBe(false);
  });

  it('binds to private IPv4 interfaces only', () => {
    const found = privateAddresses({
      en0: [
        {
          address: '192.168.1.20',
          family: 'IPv4',
          internal: false,
          netmask: '',
          mac: '',
          cidr: null,
        },
        {
          address: 'fe80::1',
          family: 'IPv6',
          internal: false,
          netmask: '',
          mac: '',
          cidr: null,
          scopeid: 1,
        },
      ],
      lo0: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '',
          mac: '',
          cidr: null,
        },
      ],
      utun: [
        {
          address: '100.64.0.2',
          family: 'IPv4',
          internal: false,
          netmask: '',
          mac: '',
          cidr: null,
        },
      ],
    });
    expect(found).toEqual(['192.168.1.20']);
  });
});

describe('the Bonjour announcement', () => {
  it('names the service, a random host and the port, and nothing about the machine', () => {
    const text = encodeResponse(serviceRecords(SERVICE)).toString('latin1');

    expect(text).toContain('_memnox');
    expect(text).toContain(SERVICE.instance);
    expect(text).toContain('v=1');
    expect(text).not.toMatch(/mac|iphone|users/i);
  });

  it('answers a browse for _memnox._tcp with everything resolving it needs, and nothing else', () => {
    const asked = readQuery(query(MDNS_SERVICE, PTR));
    const records = answersFor(asked?.questions ?? [], SERVICE);

    expect(records.map((each) => each.type).sort()).toEqual([1, 12, 16, 33]);
    expect(
      answersFor(readQuery(query('_ssh._tcp.local', PTR))?.questions ?? [], SERVICE),
    ).toEqual([]);
  });

  it('reads no response as a query, and survives a pointer loop', () => {
    const response = encodeResponse(serviceRecords(SERVICE));
    const loop = Buffer.concat([
      query('a', PTR).subarray(0, 12),
      Buffer.from([0xc0, 12, 0, 12, 0, 1]),
    ]);

    expect(readQuery(response)).toBeNull();
    expect(readQuery(loop)).toBeNull();
  });

  it('announces on start, answers a private asker, ignores a public one, and says goodbye on stop', async () => {
    const sent: { packet: Buffer; to?: { address: string; port: number } }[] = [];
    let heard:
      ((packet: Buffer, from: { address: string; port: number }) => void) | null = null;
    let closed = false;
    const socket: MdnsSocket = {
      send: (packet, to) =>
        void sent.push({ packet, ...(to === undefined ? {} : { to }) }),
      onMessage: (listener) => {
        heard = listener;
      },
      close: () => {
        closed = true;
      },
    };
    const advertiser = new MdnsAdvertiser(SERVICE, async () => socket);
    await advertiser.start();
    const announced = sent.length;
    const deliver = heard as unknown as (
      packet: Buffer,
      from: { address: string; port: number },
    ) => void;

    deliver(query(MDNS_SERVICE, PTR), { address: '8.8.8.8', port: 5353 });
    expect(sent).toHaveLength(announced);
    deliver(query(MDNS_SERVICE, PTR, 77), { address: '192.168.1.30', port: 50_000 });
    expect(sent.at(-1)?.to).toEqual({ address: '192.168.1.30', port: 50_000 });
    expect(sent.at(-1)?.packet.readUInt16BE(0)).toBe(77);

    advertiser.stop();
    expect(closed).toBe(true);
    // A goodbye is the same records with a lifetime of zero.
    expect(
      sent
        .at(-1)
        ?.packet.equals(encodeResponse(serviceRecords(SERVICE), { goodbye: true })),
    ).toBe(true);
    expect(announced).toBe(1);
  });
});

/** A socket a test drives: what the link wrote to it, and whether it was destroyed. */
class FakeSocket implements LanSocket {
  readonly written: Buffer[] = [];
  destroyed = false;
  private data: ((chunk: Buffer) => void) | null = null;
  private close: (() => void) | null = null;
  constructor(readonly remoteAddress: string | undefined) {}
  write(data: Buffer): void {
    this.written.push(data);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close?.();
  }
  onData(listener: (chunk: Buffer) => void): void {
    this.data = listener;
  }
  onClose(listener: () => void): void {
    this.close = listener;
  }
  says(bytes: Buffer): void {
    this.data?.(bytes);
  }
}

/** A listener that binds nothing: it keeps the accept callback and the ports asked for. */
function fakeListen(taken: number[] = []): {
  listen: ListenLan;
  accept: (socket: LanSocket) => void;
  asked: { host: string; port: number }[];
} {
  const asked: { host: string; port: number }[] = [];
  let accept: (socket: LanSocket) => void = () => undefined;
  const listen: ListenLan = async (host, port, onSocket) => {
    asked.push({ host, port });
    if (taken.includes(port)) throw new Error('EADDRINUSE');
    accept = onSocket;
    return { port: port === 0 ? 51_000 : port, server: { close: () => undefined } };
  };
  return { listen, accept: (socket) => accept(socket), asked };
}

function linkWith(
  listen: ListenLan,
  seen: string[] = [],
  clock: { now: number } = { now: 0 },
): LanLink {
  return new LanLink({
    instance: SERVICE.instance,
    onMessage: (connection, message) =>
      void seen.push(`${connection.address} ${message.payload[0]}`),
    onClosed: () => undefined,
    log: () => undefined,
    listen,
    addresses: () => ['192.168.1.20', '10.0.0.5'],
    advertise: () => ({ start: async () => undefined, stop: () => undefined }),
    now: () => clock.now,
  });
}

describe('the local listener', () => {
  it('binds every private address on one port, taking a free one when the usual is in use', async () => {
    const fake = fakeListen([47_390]);
    const link = linkWith(fake.listen);
    await link.start();

    expect(link.state()).toEqual({
      listening: true,
      addresses: ['192.168.1.20', '10.0.0.5'],
      port: 51_000,
      advertised: true,
    });
    expect(fake.asked.map((each) => each.host)).toEqual([
      '192.168.1.20',
      '192.168.1.20',
      '10.0.0.5',
    ]);
    link.stop();
    expect(link.state()).toEqual({ listening: false, addresses: [], advertised: false });
  });

  it('listens on nothing where the machine has no private address', async () => {
    const fake = fakeListen();
    const link = new LanLink({
      instance: SERVICE.instance,
      onMessage: () => undefined,
      onClosed: () => undefined,
      log: () => undefined,
      listen: fake.listen,
      addresses: () => [],
    });
    await link.start();
    expect(link.state().listening).toBe(false);
    expect(fake.asked).toEqual([]);
  });

  it('refuses a public address, and caps connections from one address', async () => {
    const fake = fakeListen();
    const link = linkWith(fake.listen);
    await link.start();

    const outside = new FakeSocket('203.0.113.9');
    fake.accept(outside);
    expect(outside.destroyed).toBe(true);
    const near = Array.from({ length: 5 }, () => new FakeSocket('192.168.1.40'));
    for (const each of near) fake.accept(each);
    expect(near.map((each) => each.destroyed)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    link.stop();
    expect(near.every((each) => each.destroyed)).toBe(true);
  });

  it('closes an address that starts more handshakes a minute than any phone does', async () => {
    const fake = fakeListen();
    const seen: string[] = [];
    const clock = { now: 0 };
    const link = linkWith(fake.listen, seen, clock);
    await link.start();
    const socket = new FakeSocket('192.168.1.41');
    fake.accept(socket);
    const hello =
      lanFrame(MAILBOX, frame(FRAME.HANDSHAKE, Buffer.alloc(8))) ?? Buffer.alloc(0);

    for (let index = 0; index < 10; index++) socket.says(hello);
    expect(socket.destroyed).toBe(false);
    socket.says(hello);
    expect(socket.destroyed).toBe(true);
    expect(seen).toHaveLength(10);

    clock.now = 61_000;
    const later = new FakeSocket('192.168.1.41');
    fake.accept(later);
    later.says(hello);
    expect(later.destroyed).toBe(false);
    link.stop();
  });

  it('drops a connection whose length prefix is past any relay message', async () => {
    const fake = fakeListen();
    const link = linkWith(fake.listen);
    await link.start();
    const socket = new FakeSocket('192.168.1.42');
    fake.accept(socket);
    socket.says(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    expect(socket.destroyed).toBe(true);
    link.stop();
  });
});
