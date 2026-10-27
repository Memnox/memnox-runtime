/**
 * A run's own relay to wherever the daemon's egress proxy listens now, or a stand-in when it
 * listens nowhere, since an agent outlives a daemon restart and a dead port refuses every call.
 */
import { connect, createServer, type Socket } from 'node:net';

import { EGRESS_IDLE_MS, EGRESS_LOOPBACK, EGRESS_MAX_CONNECTIONS } from './egress-server';

/** Whether the run's connections are reaching the daemon or the stand-in. */
export const RELAY_STATE = {
  WATCHED: 'watched',
  UNWATCHED: 'unwatched',
} as const;

export type RelayState = (typeof RELAY_STATE)[keyof typeof RELAY_STATE];

export interface EgressRelayOptions {
  /** The daemon's port right now, or null when none is running. Asked per connection. */
  upstream: () => Promise<number | null>;
  /** The port of a proxy that lets the agent through, started the first time it is needed. */
  standIn: () => Promise<number>;
  /** Told once per change, so a person hears it when the daemon goes and when it is back. */
  changed: (state: RelayState) => void;
  /** Zero asks the kernel for a free one. */
  port?: number;
}

export interface EgressRelay {
  port: number;
  close: () => Promise<void>;
}

/** Listens on loopback and never reads a byte: it only decides where the bytes go. */
export async function startEgressRelay(
  options: EgressRelayOptions,
): Promise<EgressRelay> {
  const open = new Set<Socket>();
  let state: RelayState = RELAY_STATE.WATCHED;
  const settle = (next: RelayState): void => {
    if (next === state) return;
    state = next;
    options.changed(next);
  };
  const server = createServer((client) => {
    open.add(client);
    client.once('close', () => open.delete(client));
    client.setTimeout(EGRESS_IDLE_MS, () => client.destroy());
    client.on('error', () => client.destroy());
    void carry(client, options, settle, open);
  });
  server.maxConnections = EGRESS_MAX_CONNECTIONS;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, EGRESS_LOOPBACK, () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The daemon first, and the stand-in when it is not there to take the connection. */
async function carry(
  client: Socket,
  options: EgressRelayOptions,
  settle: (state: RelayState) => void,
  open: Set<Socket>,
): Promise<void> {
  const daemon = await options.upstream().catch(() => null);
  const reached = daemon === null ? null : await reach(daemon);
  if (reached !== null) {
    settle(RELAY_STATE.WATCHED);
    return join(client, reached, open);
  }
  settle(RELAY_STATE.UNWATCHED);
  try {
    const standIn = await reach(await options.standIn());
    if (standIn !== null) return join(client, standIn, open);
  } catch {
    // Nothing left to carry it to; the agent sees a refusal as it would have anyway.
  }
  client.destroy();
}

/** A connected socket, or null when nothing listens there, without a byte sent yet. */
function reach(port: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(port, EGRESS_LOOPBACK);
    socket.once('connect', () => {
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', () => resolve(null));
  });
}

function join(client: Socket, upstream: Socket, open: Set<Socket>): void {
  open.add(upstream);
  upstream.once('close', () => {
    open.delete(upstream);
    client.destroy();
  });
  upstream.on('error', () => upstream.destroy());
  client.once('close', () => upstream.destroy());
  // The client has been paused since it connected, so nothing it sent is lost.
  client.pipe(upstream);
  upstream.pipe(client);
}
