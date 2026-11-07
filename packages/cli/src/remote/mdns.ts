import { createSocket } from 'node:dgram';
import { isPrivateAddress } from './lan-frames';

/**
 * The Bonjour announcement of a listening machine: `_memnox._tcp` under a random instance name,
 * which is also its host name, so nothing on the network learns whose machine it is. It answers
 * only what is asked of those names, and only to a private address.
 */

export const MDNS_SERVICE = '_memnox._tcp.local';
const SERVICES_BROWSE = '_services._dns-sd._udp.local';
const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 } as const;
const CLASS_IN = 1;
/** The top bit of a record's class: this answer replaces whatever a cache held for the name. */
const CACHE_FLUSH = 0x8000;
/** An authoritative response, as every mDNS answer is. */
const RESPONSE_FLAGS = 0x8400;
const QUERY_BIT = 0x8000;

/** RFC 6762's lifetimes: names that rarely change for long, addresses for two minutes. */
const SHARED_TTL = 4500;
const HOST_TTL = 120;
/** Two announcements a second apart, as the RFC asks of a new service. */
const ANNOUNCE_GAP_MS = 1_000;
/** A pointer chain longer than this in a question is a loop, not a name. */
const MOST_POINTERS = 16;
const POINTER = 0xc0;
const HEADER_BYTES = 12;

/** What the announcement says: the random name, the port and the private addresses behind it. */
export interface MdnsService {
  instance: string;
  port: number;
  addresses: readonly string[];
}

interface DnsRecord {
  name: string;
  type: number;
  unique: boolean;
  ttl: number;
  data: Buffer;
}

interface Question {
  name: string;
  type: number;
}

function encodeName(name: string): Buffer {
  const parts = name
    .split('.')
    .filter((each) => each !== '')
    .map((label) => {
      const bytes = Buffer.from(label, 'utf8');
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
}

function encodeRecord(record: DnsRecord, ttl: number): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt16BE(record.type, 0);
  head.writeUInt16BE(CLASS_IN | (record.unique ? CACHE_FLUSH : 0), 2);
  head.writeUInt32BE(ttl, 4);
  return Buffer.concat([
    encodeName(record.name),
    head,
    u16(record.data.length),
    record.data,
  ]);
}

/** Every record the service is known by; a goodbye sends the same with a lifetime of zero. */
export function serviceRecords(service: MdnsService): DnsRecord[] {
  const full = `${service.instance}.${MDNS_SERVICE}`;
  const host = `${service.instance}.local`;
  const srv = Buffer.concat([u16(0), u16(0), u16(service.port), encodeName(host)]);
  const txt = Buffer.from('v=1', 'utf8');
  return [
    {
      name: MDNS_SERVICE,
      type: TYPE.PTR,
      unique: false,
      ttl: SHARED_TTL,
      data: encodeName(full),
    },
    { name: full, type: TYPE.SRV, unique: true, ttl: HOST_TTL, data: srv },
    {
      name: full,
      type: TYPE.TXT,
      unique: true,
      ttl: SHARED_TTL,
      data: Buffer.concat([Buffer.from([txt.length]), txt]),
    },
    ...service.addresses.map((address) => ({
      name: host,
      type: TYPE.A,
      unique: true,
      ttl: HOST_TTL,
      data: Buffer.from(address.split('.').map(Number)),
    })),
    {
      name: SERVICES_BROWSE,
      type: TYPE.PTR,
      unique: false,
      ttl: SHARED_TTL,
      data: encodeName(MDNS_SERVICE),
    },
  ];
}

/** A response carrying the records given, under the query's id where a legacy resolver asked. */
export function encodeResponse(
  records: readonly DnsRecord[],
  options: { id?: number; goodbye?: boolean } = {},
): Buffer {
  const head = Buffer.alloc(HEADER_BYTES);
  head.writeUInt16BE(options.id ?? 0, 0);
  head.writeUInt16BE(RESPONSE_FLAGS, 2);
  head.writeUInt16BE(records.length, 6);
  const body = records.map((record) =>
    encodeRecord(record, options.goodbye === true ? 0 : record.ttl),
  );
  return Buffer.concat([head, ...body]);
}

/** The questions of a query, or null for a response or for bytes that are not a DNS message. */
export function readQuery(packet: Buffer): { id: number; questions: Question[] } | null {
  if (packet.length < HEADER_BYTES) return null;
  if ((packet.readUInt16BE(2) & QUERY_BIT) !== 0) return null;
  const count = packet.readUInt16BE(4);
  const questions: Question[] = [];
  let at = HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    const name = readName(packet, at);
    if (name === null || name.end + 4 > packet.length) return null;
    questions.push({
      name: name.text.toLowerCase(),
      type: packet.readUInt16BE(name.end),
    });
    // The class is stepped over: a unicast ask is served by the multicast answer as well.
    at = name.end + 4;
  }
  return { id: packet.readUInt16BE(0), questions };
}

/** A name with its compression pointers followed, and where the bytes after it start. */
function readName(packet: Buffer, start: number): { text: string; end: number } | null {
  const labels: string[] = [];
  let at = start;
  let end: number | null = null;
  for (let pointers = 0; pointers <= MOST_POINTERS;) {
    if (at >= packet.length) return null;
    const length = packet[at] ?? 0;
    if (length === 0) return { text: labels.join('.'), end: end ?? at + 1 };
    if ((length & POINTER) === POINTER) {
      if (at + 1 >= packet.length) return null;
      end ??= at + 2;
      at = ((length & ~POINTER) << 8) | (packet[at + 1] ?? 0);
      pointers += 1;
      continue;
    }
    if (at + 1 + length > packet.length) return null;
    labels.push(packet.subarray(at + 1, at + 1 + length).toString('utf8'));
    at += 1 + length;
  }
  return null;
}

/** The records that answer the questions asked, none when nothing asked is this service. */
export function answersFor(
  questions: readonly Question[],
  service: MdnsService,
): DnsRecord[] {
  const records = serviceRecords(service);
  const picked = new Set<DnsRecord>();
  for (const question of questions) {
    for (const record of records) {
      if (record.name.toLowerCase() !== question.name) continue;
      if (question.type !== TYPE.ANY && question.type !== record.type) continue;
      picked.add(record);
    }
  }
  // A browse that found the pointer is handed what resolving it needs, saving it a second ask.
  const pointed = [...picked].some((record) => record.name === MDNS_SERVICE);
  if (pointed)
    for (const record of records) if (record.name !== SERVICES_BROWSE) picked.add(record);
  return records.filter((record) => picked.has(record));
}

/** The part of a UDP socket the announcement uses, so a test hands in a pipe instead of a network. */
export interface MdnsSocket {
  /** To the multicast group on every listening interface, or straight back to one asker. */
  send(packet: Buffer, to?: { address: string; port: number }): void;
  onMessage(
    listener: (packet: Buffer, from: { address: string; port: number }) => void,
  ): void;
  close(): void;
}

type OpenMdns = (addresses: readonly string[]) => Promise<MdnsSocket>;

export class MdnsAdvertiser {
  private socket: MdnsSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly service: MdnsService,
    private readonly open: OpenMdns = openMdnsSocket,
  ) {}

  async start(): Promise<void> {
    if (this.socket !== null) return;
    const socket = await this.open(this.service.addresses);
    this.socket = socket;
    socket.onMessage((packet, from) => this.answer(packet, from));
    const announcement = encodeResponse(serviceRecords(this.service));
    socket.send(announcement);
    this.timer = setTimeout(() => this.socket?.send(announcement), ANNOUNCE_GAP_MS);
    this.timer.unref();
  }

  /** Says goodbye so every cache drops the name at once, then closes. */
  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    socket.send(encodeResponse(serviceRecords(this.service), { goodbye: true }));
    socket.close();
  }

  private answer(packet: Buffer, from: { address: string; port: number }): void {
    if (!isPrivateAddress(from.address)) return;
    const query = readQuery(packet);
    if (query === null) return;
    const records = answersFor(query.questions, this.service);
    if (records.length === 0) return;
    // A resolver asking from a port other than 5353 is a one shot one, answered straight back.
    if (from.port !== MDNS_PORT)
      return this.socket?.send(encodeResponse(records, { id: query.id }), from);
    this.socket?.send(encodeResponse(records));
  }
}

/** One UDP socket on 5353, shared with the system's own responder, joined on each private interface. */
async function openMdnsSocket(addresses: readonly string[]): Promise<MdnsSocket> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(MDNS_PORT, () => {
      socket.off('error', reject);
      resolve();
    });
  });
  socket.setMulticastTTL(255);
  for (const address of addresses) socket.addMembership(MDNS_GROUP, address);
  // A packet that could not go out is a missed announcement, which the next query makes up for.
  socket.on('error', () => undefined);
  return {
    send: (packet, to) => {
      if (to !== undefined) return void socket.send(packet, to.port, to.address);
      for (const address of addresses) {
        socket.setMulticastInterface(address);
        socket.send(packet, MDNS_PORT, MDNS_GROUP);
      }
    },
    onMessage: (listener) =>
      socket.on('message', (packet, info) =>
        listener(packet, { address: info.address, port: info.port }),
      ),
    close: () => socket.close(),
  };
}
