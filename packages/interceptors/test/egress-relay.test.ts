import { connect, createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RELAY_STATE,
  startEgressRelay,
  type EgressRelay,
  type RelayState,
} from '../src/egress-relay';

/** A listener that answers every line it is sent with its own name, like a proxy would. */
async function echoing(name: string): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.on('data', (chunk) => socket.end(`${name}:${chunk.toString()}`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No port taken');
  return { server, port: address.port };
}

/** A port that was free a moment ago and nobody listens on now. */
async function nobodyListening(): Promise<number> {
  const { server, port } = await echoing('gone');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function ask(port: number, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(line));
    let said = '';
    socket.on('data', (chunk) => (said += chunk.toString()));
    socket.on('end', () => resolve(said));
    socket.on('error', reject);
  });
}

const opened: { close: () => unknown }[] = [];

afterEach(async () => {
  for (const each of opened.splice(0)) await each.close();
});

async function relayTo(
  upstream: () => Promise<number | null>,
  standIn: () => Promise<number>,
): Promise<{ relay: EgressRelay; heard: RelayState[] }> {
  const heard: RelayState[] = [];
  const relay = await startEgressRelay({
    upstream,
    standIn,
    changed: (state) => heard.push(state),
  });
  opened.push(relay);
  return { relay, heard };
}

describe('the relay a run points its agent at', () => {
  it('carries a connection to the daemon while it runs, and says nothing', async () => {
    const daemon = await echoing('daemon');
    opened.push(daemon.server);
    const { relay, heard } = await relayTo(
      async () => daemon.port,
      async () => {
        throw new Error('The stand-in is not needed');
      },
    );
    expect(await ask(relay.port, 'hello')).toBe('daemon:hello');
    expect(heard).toEqual([]);
  });

  it('lets the agent through the stand-in when the daemon is gone, and says so once', async () => {
    const standIn = await echoing('stand-in');
    opened.push(standIn.server);
    const gone = await nobodyListening();
    const { relay, heard } = await relayTo(
      async () => gone,
      async () => standIn.port,
    );
    expect(await ask(relay.port, 'one')).toBe('stand-in:one');
    expect(await ask(relay.port, 'two')).toBe('stand-in:two');
    expect(heard).toEqual([RELAY_STATE.UNWATCHED]);
  });

  it('goes back to the daemon when it returns on another port, and says that too', async () => {
    const standIn = await echoing('stand-in');
    opened.push(standIn.server);
    let daemonPort: number | null = null;
    const { relay, heard } = await relayTo(
      async () => daemonPort,
      async () => standIn.port,
    );
    expect(await ask(relay.port, 'before')).toBe('stand-in:before');
    const daemon = await echoing('daemon');
    opened.push(daemon.server);
    daemonPort = daemon.port;
    expect(await ask(relay.port, 'after')).toBe('daemon:after');
    expect(heard).toEqual([RELAY_STATE.UNWATCHED, RELAY_STATE.WATCHED]);
  });
});
