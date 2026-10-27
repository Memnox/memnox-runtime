import { chmod, mkdir, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import {
  brokerPathFor,
  credentialsFor,
  isNamedPipe,
  parseBrokerRequest,
  type BrokerReply,
  type HeldCredentials,
} from '@memnox/core';

/**
 * The held credentials, in this process's memory and nowhere else: never on disk, so a
 * crash leaves nothing behind, and gone the moment the agent exits and this closes.
 */
export interface CredentialBroker {
  path: string;
  /** How many variables were held, so the start screen can say so without naming them. */
  held: number;
  close: () => Promise<void>;
}

/** A request is one short line; anything longer is not one of ours. */
const MOST_REQUEST_BYTES = 512;

export async function startBroker(
  home: string,
  sessionId: string,
  held: HeldCredentials,
): Promise<CredentialBroker> {
  const path = brokerPathFor(home, sessionId);
  // A Windows pipe has no file: nothing to make, clear, chmod or remove after.
  const file = !isNamedPipe(path);
  if (file) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // A socket left by a crashed run under the same id would refuse the listen.
  if (file) await rm(path, { force: true });
  const server = createServer((socket) => answer(socket, held));
  await listen(server, path);
  if (file) await chmod(path, 0o600);
  return {
    path,
    held: Object.keys(held).length,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      if (file) await rm(path, { force: true });
    },
  };
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** One line in, one reply out, and only the names that binary is entitled to. */
function answer(socket: Socket, held: HeldCredentials): void {
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    if (buffered.length > MOST_REQUEST_BYTES) {
      socket.destroy();
      return;
    }
    const end = buffered.indexOf('\n');
    if (end < 0) return;
    const request = parseBrokerRequest(buffered.slice(0, end));
    const reply: BrokerReply = {
      variables: request === null ? {} : credentialsFor(request.binary, held),
    };
    socket.end(`${JSON.stringify(reply)}\n`);
  });
  // A client that hangs up early is not this process's problem.
  socket.on('error', () => socket.destroy());
}
