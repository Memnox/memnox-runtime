import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  DAEMON_METHOD,
  Devices,
  pairMessage,
  PROPOSAL_KIND,
  Proposals,
  readLanSetting,
  REMOTE_OUTCOME,
  saveLanSetting,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { applyLanProposal, lanAnswer } from '../src/daemon/lan-answer';
import type { Peer } from '../src/daemon/socket-write';
import { VoiceSurface } from '../src/daemon/voice-surface';
import { RemoteEndpoint } from '../src/remote/endpoint';
import { FRAME } from '../src/remote/framing';
import { LanFrameReader, lanFrame } from '../src/remote/lan-frames';
import type { LanSocket, ListenLan } from '../src/remote/lan-link';
import { QR_VERSION, type QrPayload } from '../src/remote/pairing';
import {
  ACCOUNT,
  MAILBOX,
  MemoryRelay,
  memoryCloud,
  personKey,
  Phone,
  settle,
  type PersonKey,
  type PhoneLine,
} from './phone-harness';

/**
 * Pairing and talking over the local network with no account at all: the real snow addon, the real
 * endpoint and voice surface, and a listener that hands sockets in rather than binding a port.
 */

const NOW = '2026-10-30T10:00:00.000Z';
const DISK_TURNS = 200_000;
const HOST = '192.168.1.20';

async function waitFor(check: () => boolean, never: string): Promise<void> {
  if (!(await settle(check, DISK_TURNS))) throw new Error(never);
}

class Lines implements Peer {
  destroyed = false;
  readonly lines: DaemonResponse[] = [];
  write(line: string): void {
    this.lines.push(JSON.parse(line) as DaemonResponse);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** A phone's end of one local connection: what it sends goes in framed, what the runtime wrote comes out split. */
class PhoneSocket implements LanSocket {
  readonly remoteAddress: string;
  destroyed = false;
  /** Payloads the phone already decrypted, and the answers they held. */
  taken = 0;
  readonly heard: DaemonResponse[] = [];
  private readonly written: Buffer[] = [];
  private data: ((chunk: Buffer) => void) | null = null;
  private close: (() => void) | null = null;
  constructor(address = '192.168.1.50') {
    this.remoteAddress = address;
  }
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
  readonly line: PhoneLine = {
    deliver: (mailbox, payload) =>
      this.data?.(lanFrame(mailbox, payload) ?? Buffer.alloc(0)),
  };
  payloads(): Buffer[] {
    const reader = new LanFrameReader();
    return reader.push(Buffer.concat(this.written)).map((each) => each.payload);
  }
}

interface Rig {
  home: string;
  endpoint: RemoteEndpoint;
  relay: MemoryRelay;
  cloud: ReturnType<typeof memoryCloud>;
  mac: PersonKey;
  connect: (socket: LanSocket) => void;
  bound: () => boolean;
  ask: (request: Omit<DaemonRequest, 'id'>) => Promise<DaemonResponse>;
}

async function rig(lanOn = true, signedIn = false): Promise<Rig> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-lan-'));
  const mac = personKey();
  await new ConfirmKeys(home).register(mac.point, NOW);
  if (lanOn) await saveLanSetting(home, true);
  const relay = new MemoryRelay();
  const cloud = memoryCloud();
  let accept: ((socket: LanSocket) => void) | null = null;
  const listen: ListenLan = async (_host, port, onSocket) => {
    accept = onSocket;
    return {
      port,
      server: {
        close: () => {
          accept = null;
        },
      },
    };
  };
  let voice: VoiceSurface | null = null;
  const endpoint = new RemoteEndpoint({
    home,
    now: () => NOW,
    log: () => undefined,
    voice: () => voice,
    cloud,
    openRelay: relay.open,
    account: async () => (signedIn ? ACCOUNT : null),
    speaks: async () => false,
    lan: {
      listen,
      addresses: () => [HOST],
      advertise: () => ({ start: async () => undefined, stop: () => undefined }),
    },
  });
  voice = new VoiceSurface({
    home,
    now: () => NOW,
    log: () => undefined,
    feedIntervalMs: 60_000,
    remote: {
      driving: (id) => endpoint.driving(id),
      tell: (id, response) => endpoint.tell(id, response),
    },
  });
  await endpoint.start();
  let next = 1;
  async function ask(request: Omit<DaemonRequest, 'id'>): Promise<DaemonResponse> {
    const peer = new Lines();
    await endpoint.respondLocal(peer, { ...request, id: next++ } as DaemonRequest);
    const [first] = peer.lines;
    if (first === undefined) throw new Error('no answer');
    return first;
  }
  return {
    home,
    endpoint,
    relay,
    cloud,
    mac,
    connect: (socket) => accept?.(socket),
    bound: () => accept !== null,
    ask,
  };
}

function qrOf(response: DaemonResponse): QrPayload {
  const link = response.pairing?.qr ?? '';
  return JSON.parse(
    Buffer.from(link.split('d=')[1] ?? '', 'base64url').toString(),
  ) as QrPayload;
}

async function reply(socket: PhoneSocket, kind: number, after: number): Promise<Buffer> {
  const found = (): Buffer | undefined =>
    socket
      .payloads()
      .slice(after)
      .find((each) => each[0] === kind);
  await waitFor(
    () => found() !== undefined,
    'the runtime never answered on the local network',
  );
  return found() ?? Buffer.alloc(0);
}

/** Pairs a phone over one local connection, signed by the Mac, and answers what the phone kept. */
async function paired(
  at: Rig,
): Promise<{ phone: Phone; runtime: Buffer; socket: PhoneSocket; qr: QrPayload }> {
  const begun = await at.ask({ method: DAEMON_METHOD.PAIR_BEGIN, name: 'Studio Mac' });
  const qr = qrOf(begun);
  const pairingId = begun.pairing?.id ?? '';
  const socket = new PhoneSocket();
  at.connect(socket);
  const phone = new Phone(socket.line, qr.mailbox);
  phone.startPairing(Buffer.from(qr.secret, 'base64'));
  const said = phone.finishPairing(await reply(socket, FRAME.HANDSHAKE, 0), 'iPhone');
  const watch = new Lines();
  await at.endpoint.respondLocal(watch, {
    id: 90,
    method: DAEMON_METHOD.PAIR_PENDING,
    pairingId,
  });
  await waitFor(
    () => watch.lines.at(-1)?.pairing?.state === 'answered',
    'the phone never proved its key',
  );
  const fingerprint = watch.lines.at(-1)?.pairing?.phone?.fingerprint ?? '';
  const accepted = await at.ask({
    method: DAEMON_METHOD.PAIR_ACCEPT,
    pairingId,
    signature: at.mac.signs(pairMessage(pairingId, fingerprint)),
  });
  expect(accepted.outcome).toBe(REMOTE_OUTCOME.PAIRED);
  return { phone, runtime: said.runtimeStatic ?? Buffer.alloc(0), socket, qr };
}

/** An IK session on a fresh connection, then one request through it and its answer. */
async function session(at: Rig, phone: Phone, runtime: Buffer): Promise<PhoneSocket> {
  const socket = new PhoneSocket();
  at.connect(socket);
  const line = socket.line;
  const swapped = new Phone(line);
  // The same phone keys on a new connection: the harness phone is rebuilt around them.
  Object.assign(swapped, { key: phone.key, noise: phone.noise });
  swapped.startSession(runtime);
  swapped.finishSession(await reply(socket, FRAME.HANDSHAKE, 0));
  socket.taken = socket.payloads().length;
  (socket as PhoneSocket & { phone: Phone }).phone = swapped;
  return socket;
}

/** Each payload is decrypted once, in order, since the phone's channel counts every message it opens. */
async function through(
  socket: PhoneSocket,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  const phone = (socket as PhoneSocket & { phone: Phone }).phone;
  const answer = (): DaemonResponse | undefined => {
    const fresh = socket.payloads().slice(socket.taken);
    socket.taken += fresh.length;
    socket.heard.push(...(phone.read(fresh) as DaemonResponse[]));
    return socket.heard.find((each) => each.id === request.id);
  };
  phone.send(request);
  await waitFor(() => answer() !== undefined, 'no answer came back');
  return answer() ?? { id: request.id, ok: false };
}

describe('a phone on the local network', () => {
  it('listens on nothing until the person turns it on', async () => {
    const at = await rig(false);
    expect(at.bound()).toBe(false);
    const status = await lanAnswer(
      at.home,
      { id: 1, method: DAEMON_METHOD.LAN_STATUS },
      new Date(NOW),
    );
    expect(status.lan).toEqual({
      on: false,
      listening: false,
      addresses: [],
      advertised: false,
      reachable: [],
    });
    const begun = await at.ask({ method: DAEMON_METHOD.PAIR_BEGIN });
    expect(begun.outcome).toBe(REMOTE_OUTCOME.REFUSED);
    at.endpoint.close();
  });

  it('pairs with no account, naming the local network and no relay in the QR', async () => {
    const at = await rig();
    const { phone, socket, qr } = await paired(at);

    expect(qr.v).toBe(QR_VERSION.LAN_ONLY);
    expect(qr.lan).toEqual({
      hosts: [HOST],
      port: 47_390,
      instance: expect.stringMatching(/^memnox-[0-9a-f]{8}$/),
    });
    expect(qr.relayUrl).toBeUndefined();
    expect(qr.pairingToken).toBeUndefined();
    expect(at.cloud.calls).toEqual([]);
    expect(at.relay.opened).toBe(0);
    const [device] = (await new Devices(at.home).all()).filter(
      (each) => each.kind === 'phone',
    );
    expect(device?.mailbox).toBeUndefined();
    expect(device?.relayTokenId).toBeUndefined();
    const welcome = phone.read(socket.payloads()).at(-1) as Record<string, unknown>;
    expect(welcome).toMatchObject({ paired: true, deviceId: device?.id });
    expect(welcome['relayToken']).toBeUndefined();
    at.endpoint.close();
  });

  it('names the relay beside the local network for a person signed in, and mints the token as before', async () => {
    const at = await rig(true, true);
    const begun = await at.ask({ method: DAEMON_METHOD.PAIR_BEGIN });
    const qr = qrOf(begun);

    expect(qr).toMatchObject({
      v: QR_VERSION.RELAY,
      machineId: ACCOUNT.machineId,
      mailbox: MAILBOX,
      pairingToken: 'rlp_test',
      lan: { hosts: [HOST], port: 47_390 },
    });
    expect(at.cloud.calls).toEqual(['open']);
    at.endpoint.close();
  });

  it('opens a session on a new connection and answers it under the same capability checks', async () => {
    const at = await rig();
    const { phone, runtime } = await paired(at);
    const socket = await session(at, phone, runtime);

    expect(await through(socket, { id: 7, method: DAEMON_METHOD.PING })).toMatchObject({
      id: 7,
      ok: true,
    });
    const status = await through(socket, { id: 8, method: DAEMON_METHOD.LAN_STATUS });
    expect(status.lan).toMatchObject({
      on: true,
      listening: true,
      port: 47_390,
      advertised: true,
    });
    expect(status.lan?.reachable.map((each) => each.name)).toEqual(['iPhone']);
    const set = await through(socket, {
      id: 9,
      method: DAEMON_METHOD.LAN_SET,
      lanOn: false,
    });
    expect(set.outcome).toBe(REMOTE_OUTCOME.REFUSED);
    const drive = await through(socket, {
      id: 10,
      method: DAEMON_METHOD.DRIVE,
      until: NOW,
    });
    expect(drive.outcome).toBe(REMOTE_OUTCOME.REFUSED);
    expect(await readLanSetting(at.home)).toBe(true);
    at.endpoint.close();
  });

  it('answers no handshake from a key it never paired', async () => {
    const at = await rig();
    const { runtime } = await paired(at);
    const socket = new PhoneSocket();
    at.connect(socket);
    const stranger = new Phone(socket.line);
    stranger.startSession(runtime);
    await settle(() => false, 2_000);
    expect(socket.payloads()).toEqual([]);
    at.endpoint.close();
  });

  it('turns off at once and closes every local connection', async () => {
    const at = await rig();
    const { phone, runtime } = await paired(at);
    const socket = await session(at, phone, runtime);

    const off = await lanAnswer(
      at.home,
      { id: 1, method: DAEMON_METHOD.LAN_SET, lanOn: false },
      new Date(NOW),
    );
    expect(off.lan).toMatchObject({ on: false, listening: false, reachable: [] });
    expect(socket.destroyed).toBe(true);
    expect(at.bound()).toBe(false);
    at.endpoint.close();
  });

  it('turns on only through a proposal the Mac signs, which opens the listener once applied', async () => {
    const at = await rig(false);
    const asked = await lanAnswer(
      at.home,
      { id: 1, method: DAEMON_METHOD.LAN_SET, lanOn: true },
      new Date(NOW),
    );

    expect(asked.proposed).toBeDefined();
    expect(await readLanSetting(at.home)).toBe(false);
    expect(at.bound()).toBe(false);
    const [proposal] = await new Proposals(at.home).open(NOW);
    expect(proposal?.id).toBe(asked.proposed);
    expect(proposal?.change).toEqual({ kind: PROPOSAL_KIND.LAN, on: true });
    expect(
      await applyLanProposal(at.home, { kind: PROPOSAL_KIND.LAN, on: true }),
    ).toMatchObject({ ok: true });
    expect(await readLanSetting(at.home)).toBe(true);
    expect(at.bound()).toBe(true);
    at.endpoint.close();
  });
});
