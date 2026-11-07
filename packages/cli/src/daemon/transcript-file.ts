import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Reads a bounded stretch from either end of a session's file, which is all the transcript readers need. */

/** The end of a long session is all the window shows, so a day of conversation is never read whole. */
const TAIL_BYTES = 1_024 * 1_024;
/** Enough of a session's start to hold its first request after whatever the agent loads first. */
const HEAD_BYTES = 256 * 1_024;

/** The first stretch of a file, since a session's opening request never moves from its start. */
export function headOf(path: string, bytes: number = HEAD_BYTES): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const length = Math.min(fstatSync(fd).size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, 0);
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    // Gone or unreadable: the card says what else it knows of the session.
    return '';
  }
}

/** The last stretch of a file, since the end of a session is what the window shows. */
export function tailOf(path: string, bytes: number = TAIL_BYTES): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    // Gone or unreadable: the window shows the rest of what it knows.
    return '';
  }
}
