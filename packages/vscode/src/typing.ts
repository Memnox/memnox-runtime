import { deviceName } from './terminal-match';

/**
 * Typing a confirmed instruction into the agent in an integrated terminal. The link names only
 * a request and a terminal: the words come from the request Memnox wrote under the person's
 * own home, so a link opened by any page can type nothing that was not already said yes to.
 */

/** A request id as Memnox mints one, and nothing that could climb out of its folder. */
const REQUEST_ID = /^dsp_[a-z0-9]+_[a-f0-9]+$/;

/** What runs a coding agent, the same list the runtime checks before it asks for typing. */
const AGENT_PROGRAMS = /^(claude|node|codex|gemini|cursor-agent|aider|opencode)$/i;

/** A native install runs a binary named for its version, so the folder it sits in names the agent. */
const AGENT_FOLDERS =
  /\/(claude|codex|gemini|cursor-agent|aider|opencode)\/(versions\/)?[^/]+$/i;

/** Why a request is left alone without a word, since another window or link already answered it. */
export const ALREADY_ANSWERED = 'it was already answered';

/** Every link Memnox sends an editor names a request and a terminal the same way. */
interface TypeLink {
  request: string;
  tty: string;
}

/** The request and terminal a link names, or null when either is not what Memnox would send. */
export function typeLinkOf(query: string): TypeLink | null {
  const params = new URLSearchParams(query);
  const request = params.get('request');
  const tty = params.get('tty');
  if (request === null || tty === null || !REQUEST_ID.test(request)) return null;
  return /^(\/dev\/)?ttys?[0-9]+$/.test(tty) ? { request, tty } : null;
}

/** The request itself, or why it may not be acted on: only one still waiting, of this kind, for this very terminal. */
export function waitingRequest(
  record: unknown,
  tty: string,
  moment: string,
  display: 'type' | 'press' | 'close' | 'interrupt',
): { request: Record<string, unknown> } | { why: string } {
  if (record === null || typeof record !== 'object') {
    return { why: 'its request is gone' };
  }
  const request = record as Record<string, unknown>;
  if (request['display'] !== display) return { why: `it is not a request to ${display}` };
  if (request['delivered'] !== undefined) return { why: ALREADY_ANSWERED };
  const expires = request['expiresAt'];
  if (typeof expires !== 'string' || expires <= moment) {
    return { why: 'it waited too long' };
  }
  const wanted = request['tty'];
  if (typeof wanted !== 'string' || deviceName(wanted) !== deviceName(tty)) {
    return { why: 'the link named a different terminal' };
  }
  return { request };
}

/** The words to type, or why not: only an instruction still waiting, for this very terminal. */
export function typableText(
  record: unknown,
  tty: string,
  moment: string,
): { text: string } | { why: string } {
  const waiting = waitingRequest(record, tty, moment, 'type');
  if ('why' in waiting) return waiting;
  const text = waiting.request['text'];
  if (typeof text !== 'string' || text.trim() === '') return { why: 'it has no words' };
  return { text: text.split(/\r?\n/).join(' ') };
}

/** The request a launch link names, or null when it is not one Memnox would send. */
export function launchLinkOf(query: string): string | null {
  const request = new URLSearchParams(query).get('request');
  return request !== null && REQUEST_ID.test(request) ? request : null;
}

/** What starts the agent: the line runs `memnox run` in its repository, so the session is governed from its first step. */
const LAUNCH_LINE = /^cd '[^']*(?:'\\''[^']*)*' && memnox run /;

/**
 * The line to type and the folder to open the terminal in, or why not: only a launch still
 * waiting, whose line is the one Memnox builds, so a request written by anything else starts nothing.
 */
export function launchable(
  record: unknown,
  moment: string,
): { line: string; cwd: string; title: string } | { why: string } {
  if (record === null || typeof record !== 'object')
    return { why: 'its request is gone' };
  const request = record as Record<string, unknown>;
  if (request['display'] !== 'launch') return { why: 'it is not a request to launch' };
  if (request['delivered'] !== undefined) return { why: ALREADY_ANSWERED };
  const expires = request['expiresAt'];
  if (typeof expires !== 'string' || expires <= moment)
    return { why: 'it waited too long' };
  const line = request['text'];
  const cwd = request['cwd'];
  if (typeof line !== 'string' || !LAUNCH_LINE.test(line) || /[\r\n]/.test(line)) {
    return { why: 'it is not a line that starts an agent' };
  }
  if (typeof cwd !== 'string' || cwd === '') return { why: 'it names no repository' };
  const title = typeof request['title'] === 'string' ? request['title'] : 'agent';
  return { line, cwd, title };
}

/** Whether `ps -o stat=,comm=` shows a coding agent in front, so words never land in a bare shell. */
export function agentInFront(listing: string): boolean {
  return listing.split('\n').some((line) => {
    const [stat, ...command] = line.trim().split(/\s+/);
    const path = command.join(' ');
    const program = path.split('/').pop() ?? '';
    return (
      stat?.includes('+') === true &&
      (AGENT_PROGRAMS.test(program) || AGENT_FOLDERS.test(path))
    );
  });
}

/**
 * The pause after each key: quick enough that a few sentences go in within about half a second,
 * still seen going in, with a breath after punctuation, the way the Mac types elsewhere.
 */
export function keyPausesMs(text: string, jitter: () => number = Math.random): number[] {
  const base = Math.min(
    SLOWEST_KEY_MS,
    Math.max(QUICKEST_KEY_MS, WHOLE_RUN_MS / Math.max(text.length, 1)),
  );
  return [...text].map((character) => {
    const breath = BREATH_MARKS.includes(character) ? BREATH_MS : 0;
    return Math.round(base * (LEAST_JITTER + JITTER_SPAN * jitter()) + breath);
  });
}

/** The whole message aims to go in within this, each key between the quickest and slowest pace. */
const WHOLE_RUN_MS = 400;
const SLOWEST_KEY_MS = 12;
const QUICKEST_KEY_MS = 1;
/** A key strays up to this far either way from the pace, so it reads as typed rather than pasted. */
const LEAST_JITTER = 0.7;
const JITTER_SPAN = 0.6;
/** The marks a person pauses after, and for how long. */
const BREATH_MARKS = ',.?!;:';
const BREATH_MS = 15;

/** The request a file in Memnox's displays folder holds, or null for anything else written there. */
export function requestOfFile(name: string | null): string | null {
  if (name === null || !name.endsWith('.json')) return null;
  const request = name.slice(0, -'.json'.length);
  return REQUEST_ID.test(request) ? request : null;
}

/**
 * Whether another editor window already took this request: a link reaches only one window, and
 * the one holding the terminal may be any of them, so the first to find it claims it before typing.
 */
export function claimedElsewhere(record: unknown, pid: number): boolean {
  if (record === null || typeof record !== 'object') return false;
  const claimed = (record as Record<string, unknown>)['claimedBy'];
  return typeof claimed === 'number' && claimed !== pid;
}

/** The kinds a window acts on unasked when the terminal is its own: words typed, and keys pressed to answer. */
export type HeldKind = 'type' | 'press';

/** The device and kind a type or press request names, for a window deciding whether the terminal is its own. */
export function deviceOfRequest(record: unknown): { tty: string; kind: HeldKind } | null {
  if (record === null || typeof record !== 'object') return null;
  const request = record as Record<string, unknown>;
  const tty = request['tty'];
  const kind = request['display'];
  if (typeof tty !== 'string' || (kind !== 'type' && kind !== 'press')) return null;
  return { tty, kind };
}
