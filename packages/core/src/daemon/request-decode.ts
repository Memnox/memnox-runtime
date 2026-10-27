import { LineBuffer } from '../domain/line-buffer';
import type { DaemonRequest, DaemonResponse } from './protocol';

/** Reading a line off the daemon's socket into a request or a response, refusing what does not fit. */

/** A line longer than this is no request anybody sends, so it ends the connection rather than filling memory. */
export const MOST_REQUEST_CHARS = 4 * 1024 * 1024;

/** The type each plain field must hold when present, so a wrong one is refused here rather than trusted further in. */
const FIELD_TYPES: Readonly<Record<string, 'string' | 'number' | 'boolean'>> = {
  sessionId: 'string',
  agent: 'string',
  action: 'string',
  target: 'string',
  dataClassification: 'string',
  argsDigest: 'string',
  reason: 'string',
  exitCode: 'number',
  outOfScope: 'boolean',
  driftOnly: 'boolean',
  costUsd: 'number',
  subject: 'string',
  answer: 'string',
  signature: 'string',
  // A phone's rewritten words reach the confirm from afar, so anything but text is refused before it is trimmed.
  edited: 'string',
  editedTo: 'string',
  questionNumber: 'number',
  point: 'string',
  said: 'string',
  finished: 'boolean',
  intent: 'string',
  greeted: 'boolean',
  family: 'string',
  selection: 'string',
  speculative: 'boolean',
  lookingAt: 'string',
  lookingAtWindow: 'string',
  owner: 'string',
  briefing: 'string',
  since: 'string',
  recheck: 'boolean',
  voiceAgent: 'string',
  told: 'boolean',
  toolkit: 'string',
  again: 'boolean',
  query: 'string',
  approved: 'string',
};
const LIST_FIELDS: readonly string[] = ['learned', 'spans', 'vocabulary'];
const OBJECT_FIELDS: readonly string[] = ['proof', 'sight', 'evidence'];

/** Null rather than a throw: a garbled line is a bad client, not a crash. */
export function decodeRequest(line: string): DaemonRequest | null {
  if (line.length > MOST_REQUEST_CHARS) return null;
  const message = parseMessage<DaemonRequest>(line);
  if (message === null || typeof message.method !== 'string') return null;
  if (!wellTyped(message)) return null;
  // Every field the protocol names is checked above; fields it does not name are read by their own method.
  return message as DaemonRequest;
}

/** Every named field present holds the type the protocol says, so nothing downstream reads a number as text. */
function wellTyped(message: object): boolean {
  const fields = Object.entries(message);
  return fields.every(([name, value]) => {
    if (value === undefined || value === null) return true;
    const scalar = FIELD_TYPES[name];
    if (scalar !== undefined) return typeof value === scalar;
    if (LIST_FIELDS.includes(name)) return Array.isArray(value);
    if (OBJECT_FIELDS.includes(name))
      return typeof value === 'object' && !Array.isArray(value);
    return true;
  });
}

export function decodeResponse(line: string): DaemonResponse | null {
  const message = parseMessage<DaemonResponse>(line);
  // Only the id is required; every other field of a response is optional.
  return message === null ? null : (message as DaemonResponse);
}

/** An object carrying a numeric id, or null for anything else, including a line that is not JSON. */
function parseMessage<T extends { id: number }>(line: string): Partial<T> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // Narrowed field by field by the callers, starting with the id here.
  const message = parsed as Partial<T>;
  return typeof message.id === 'number' ? message : null;
}

/** A reader for the daemon's socket that stops at a line too long to be any request. */
export function requestReader(): LineBuffer {
  return new LineBuffer(MOST_REQUEST_CHARS);
}
