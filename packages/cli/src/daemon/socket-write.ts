import { encode, type DaemonResponse } from '@memnox/core';

/** The part of a connection the voice writes to, so nothing here opens a socket of its own. */
export interface Peer {
  readonly destroyed: boolean;
  write(line: string): unknown;
  destroy(): unknown;
}

/** A client that hung up before its answer is ordinary, so nothing is written to it. */
export function write(socket: Peer, response: DaemonResponse): void {
  if (!socket.destroyed) socket.write(encode(response));
}
