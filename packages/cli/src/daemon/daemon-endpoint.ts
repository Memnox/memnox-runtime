/**
 * Preparing the daemon's address: a unix socket made owner only on macOS and Linux, and a
 * named pipe on Windows, whose access is the pipe's own security descriptor rather than a mode.
 */
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isNamedPipe } from '@memnox/core';

/** The shorter of the two platform limits, so one number is right on both. */
const SOCKET_PATH_LIMIT = 103;
const SOCKET_DIR_MODE = 0o700;
const SOCKET_MODE = 0o600;

/** What `listen` is handed: the address, and both widening flags spelled out as false. */
interface OwnerOnlyListen {
  path: string;
  readableAll: false;
  writableAll: false;
}

/**
 * Never readable or writable by all. On a pipe those two flags are what would add Everyone
 * to its access list, so they are named false here rather than left to a default.
 */
export function listenOptionsFor(address: string): OwnerOnlyListen {
  return { path: address, readableAll: false, writableAll: false };
}

/** Over the kernel's cap `listen` fails with EADDRINUSE, so the real cause is named first. */
export async function prepareAddress(address: string): Promise<void> {
  // A pipe lives in the kernel's namespace: no directory to make and no length cap to meet.
  if (isNamedPipe(address)) return;
  if (Buffer.byteLength(address) > SOCKET_PATH_LIMIT) {
    throw new Error(
      `The daemon's socket path is ${Buffer.byteLength(address)} bytes and the kernel allows ${SOCKET_PATH_LIMIT}:\n  ${address}\n` +
        'Use a shorter home directory. The interceptors still evaluate in process, which is the same rules.',
    );
  }
  await mkdir(dirname(address), { recursive: true, mode: SOCKET_DIR_MODE });
}

/** Owner only, because anything that can talk to this socket can ask about your rules. */
export async function secureAddress(address: string): Promise<void> {
  // A pipe has no mode: chmod would fail, and its access was set when it was created.
  if (isNamedPipe(address)) return;
  await chmod(address, SOCKET_MODE);
}
