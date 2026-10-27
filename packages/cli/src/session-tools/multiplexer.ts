import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostOf, type DeliveryProof, type HostProcess, type ShownIn } from '@memnox/core';
import { processChain } from '@memnox/interceptors';

/**
 * Typing into an agent that runs in a tmux or WezTerm pane, through the multiplexer's own command
 * line, so it reaches the right pane whichever app shows it and with no window brought forward.
 */

const MULTIPLEXER = {
  TMUX: 'tmux',
  WEZTERM: 'WezTerm',
} as const;

export type MultiplexerName = (typeof MULTIPLEXER)[keyof typeof MULTIPLEXER];

/** The pane a session's terminal is, and the program that owns it. */
export interface Pane {
  multiplexer: MultiplexerName;
  id: string;
  /** The multiplexer's program, found where it is installed, since the daemon's PATH may not have it. */
  program: string;
}

export interface PaneSeams {
  /** Runs a program with no shell; its output, or null when it is not there or failed. */
  run: (file: string, args: readonly string[]) => string | null;
  pause: (ms: number) => Promise<void>;
}

/** Where each multiplexer is installed, PATH first, then Homebrew and the app bundle. */
const PROGRAMS: Readonly<Record<MultiplexerName, readonly string[]>> = {
  [MULTIPLEXER.TMUX]: ['tmux', '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'],
  [MULTIPLEXER.WEZTERM]: [
    'wezterm',
    '/opt/homebrew/bin/wezterm',
    '/Applications/WezTerm.app/Contents/MacOS/wezterm',
  ],
};

/** How people say each one aloud, and how a recognizer hears it. */
const SPOKEN: Readonly<Record<MultiplexerName, readonly string[]>> = {
  [MULTIPLEXER.TMUX]: ['tmux', 'teamux'],
  [MULTIPLEXER.WEZTERM]: ['wezterm', 'westerm'],
};

/** The keys a pane is sent, by tmux's own names for them. */
const PANE_KEY = {
  ENTER: 'Enter',
  ESCAPE: 'Escape',
} as const;

type PaneKey = (typeof PANE_KEY)[keyof typeof PANE_KEY];

/** WezTerm has no key names, so each key is sent as the character a terminal reads for it. */
const KEY_CHARACTER: Readonly<Record<PaneKey, string>> = {
  [PANE_KEY.ENTER]: '\r',
  [PANE_KEY.ESCAPE]: '\u001b',
};

/** What tmux prints for each pane and client, its fields split by FIELD_SEPARATOR. */
const TMUX_FORMAT = {
  PANE_TTY_AND_ID: '#{pane_tty} #{pane_id}',
  PANE_ID: '#{pane_id}',
  SESSION_NAME: '#{session_name}',
  CLIENT_SESSION_AND_PID: '#{client_session} #{client_pid}',
} as const;

const FIELD_SEPARATOR = ' ';
const LINE_BREAK = '\n';

/** The fields of a pane in `wezterm cli list --format json`. */
const WEZTERM_FIELD = {
  TTY: 'tty_name',
  PANE: 'pane_id',
} as const;

/** Every question and order each multiplexer is given, by its own command line, in one place. */
interface Commands {
  panes: readonly string[];
  running: readonly string[];
  open: (folder: string) => readonly string[];
  close: (id: string) => readonly string[];
  show: (id: string) => readonly (readonly string[])[];
  text: (id: string, line: string) => readonly string[];
  key: (id: string, key: PaneKey) => readonly string[];
  read: (id: string) => readonly string[];
}

const COMMANDS: Readonly<Record<MultiplexerName, Commands>> = {
  [MULTIPLEXER.TMUX]: {
    panes: ['list-panes', '-a', '-F', TMUX_FORMAT.PANE_TTY_AND_ID],
    running: ['list-sessions'],
    open: (folder) => ['new-window', '-c', folder, '-P', '-F', TMUX_FORMAT.PANE_ID],
    close: (id) => ['kill-pane', '-t', id],
    show: (id) => [
      ['select-window', '-t', id],
      ['select-pane', '-t', id],
    ],
    text: (id, line) => ['send-keys', '-t', id, '-l', line],
    key: (id, key) => ['send-keys', '-t', id, key],
    read: (id) => ['capture-pane', '-p', '-t', id],
  },
  [MULTIPLEXER.WEZTERM]: {
    panes: ['cli', 'list', '--format', 'json'],
    running: ['cli', 'list'],
    open: (folder) => ['cli', 'spawn', '--cwd', folder],
    close: (id) => ['cli', 'kill-pane', '--pane-id', id],
    show: (id) => [['cli', 'activate-pane', '--pane-id', id]],
    text: (id, line) => ['cli', 'send-text', '--pane-id', id, '--no-paste', line],
    key: (id, key) => [
      'cli',
      'send-text',
      '--pane-id',
      id,
      '--no-paste',
      KEY_CHARACTER[key],
    ],
    read: (id) => ['cli', 'get-text', '--pane-id', id],
  },
};

/** tmux's questions about the session a pane is in and the clients showing it. */
const TMUX_ASK = {
  sessionOf: (id: string): readonly string[] => [
    'display-message',
    '-p',
    '-t',
    id,
    TMUX_FORMAT.SESSION_NAME,
  ],
  clients: ['list-clients', '-F', TMUX_FORMAT.CLIENT_SESSION_AND_PID] as const,
};

/** A client line is its session then its process, as TMUX_FORMAT asks for. */
const CLIENT_FIELDS = 2;
const CLIENT_PID_FIELD = 1;

/** A beat before Return, since an agent reads text and Return arriving together as a paste. */
const BEFORE_RETURN_MS = 150;
/** Long enough for an agent to take the words and draw them in its conversation. */
const BEFORE_READBACK_MS = 300;
/** Enough of the start of the words to know them again, short enough that a wrapped line still holds it. */
const READBACK_CHARS = 32;

/** The tmux or WezTerm pane on this terminal, or null when neither holds it. */
export function paneOn(tty: string, seams: PaneSeams = NODE_SEAMS): Pane | null {
  const device = basename(tty);
  for (const program of PROGRAMS[MULTIPLEXER.TMUX]) {
    const listing = seams.run(program, COMMANDS[MULTIPLEXER.TMUX].panes);
    if (listing === null) continue;
    for (const line of listing.split(LINE_BREAK)) {
      const [paneTty, id] = line.trim().split(FIELD_SEPARATOR);
      if (paneTty !== undefined && id !== undefined && basename(paneTty) === device)
        return { multiplexer: MULTIPLEXER.TMUX, id, program };
    }
    break;
  }
  for (const program of PROGRAMS[MULTIPLEXER.WEZTERM]) {
    const listing = seams.run(program, COMMANDS[MULTIPLEXER.WEZTERM].panes);
    if (listing === null) continue;
    const id = weztermPane(listing, device);
    return id === null ? null : { multiplexer: MULTIPLEXER.WEZTERM, id, program };
  }
  return null;
}

function weztermPane(listing: string, device: string): string | null {
  let panes: unknown;
  try {
    panes = JSON.parse(listing);
  } catch {
    return null;
  }
  if (!Array.isArray(panes)) return null;
  for (const pane of panes as unknown[]) {
    if (typeof pane !== 'object' || pane === null) continue;
    // A parsed JSON object is a string-keyed record.
    const fields = pane as Record<string, unknown>;
    const name = fields[WEZTERM_FIELD.TTY];
    const id = fields[WEZTERM_FIELD.PANE];
    if (typeof name === 'string' && basename(name) === device && typeof id === 'number')
      return String(id);
  }
  return null;
}

/** The words typed into the pane and sent, with what was read back when they could be seen there. */
export async function typeIntoPane(
  pane: Pane,
  text: string,
  seams: PaneSeams = NODE_SEAMS,
): Promise<{ sent: boolean; proof?: DeliveryProof }> {
  const line = text.split(/\r?\n/).join(FIELD_SEPARATOR);
  const commands = COMMANDS[pane.multiplexer];
  if (seams.run(pane.program, commands.text(pane.id, line)) === null)
    return { sent: false };
  await seams.pause(BEFORE_RETURN_MS);
  if (seams.run(pane.program, commands.key(pane.id, PANE_KEY.ENTER)) === null)
    return { sent: false };
  await seams.pause(BEFORE_READBACK_MS);
  const seen = readBack(pane, line, seams);
  return seen === null
    ? { sent: true }
    : {
        sent: true,
        proof: { checked: `the words in its ${pane.multiplexer} pane`, seen },
      };
}

/** The multiplexer a person names, as they say it, or null for anything else. */
export function multiplexerNamed(said: string): MultiplexerName | null {
  const name = said.toLowerCase().replace(/[^a-z]/g, '');
  const named = (Object.keys(SPOKEN) as MultiplexerName[]).find((each) =>
    SPOKEN[each].includes(name),
  );
  return named ?? null;
}

/** Where the multiplexer is installed and answering, or null when none of it is running here. */
export function runningMultiplexer(
  multiplexer: MultiplexerName,
  seams: PaneSeams = NODE_SEAMS,
): string | null {
  const asks = COMMANDS[multiplexer].running;
  return (
    PROGRAMS[multiplexer].find((program) => seams.run(program, asks) !== null) ?? null
  );
}

/** A new window in the running multiplexer, opened in the folder, or null when it would not open. */
export function openPane(
  multiplexer: MultiplexerName,
  folder: string,
  seams: PaneSeams = NODE_SEAMS,
): Pane | null {
  const program = runningMultiplexer(multiplexer, seams);
  if (program === null) return null;
  const id = seams.run(program, COMMANDS[multiplexer].open(folder))?.trim() ?? '';
  return id === '' ? null : { multiplexer, id, program };
}

/** The pane closed, which hangs up on the agent in it as closing a terminal tab does. */
export function closePane(pane: Pane, seams: PaneSeams = NODE_SEAMS): boolean {
  return seams.run(pane.program, COMMANDS[pane.multiplexer].close(pane.id)) !== null;
}

/**
 * The pane brought to the front inside its multiplexer, and the terminal it is seen in: the app and
 * tab running the tmux client attached to it, or WezTerm itself.
 */
export function showPane(
  pane: Pane,
  seams: PaneSeams = NODE_SEAMS,
  chainOf: (pid: number) => HostProcess[] = processChain,
): ShownIn | null {
  for (const order of COMMANDS[pane.multiplexer].show(pane.id))
    seams.run(pane.program, order);
  // WezTerm is its own app, so it is the terminal the pane is seen in.
  if (pane.multiplexer === MULTIPLEXER.WEZTERM) return { app: MULTIPLEXER.WEZTERM };
  const session = seams.run(pane.program, TMUX_ASK.sessionOf(pane.id))?.trim();
  const clients = (seams.run(pane.program, TMUX_ASK.clients) ?? '')
    .split(LINE_BREAK)
    .map((line) => line.trim().split(FIELD_SEPARATOR))
    .filter((fields) => fields.length === CLIENT_FIELDS);
  const client = clients.find(([name]) => name === session) ?? clients[0];
  const pid = Number(client?.[CLIENT_PID_FIELD]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const seen = hostOf(chainOf(pid));
  return seen.app === undefined ? null : seen;
}

/** Escape in the pane, as the person would press it to stop the agent there. */
export function pressEscapeIn(pane: Pane, seams: PaneSeams = NODE_SEAMS): boolean {
  return (
    seams.run(pane.program, COMMANDS[pane.multiplexer].key(pane.id, PANE_KEY.ESCAPE)) !==
    null
  );
}

/** The start of the words as the pane shows them now, or null when they cannot be seen there. */
function readBack(pane: Pane, line: string, seams: PaneSeams): string | null {
  const screen = seams.run(pane.program, COMMANDS[pane.multiplexer].read(pane.id));
  if (screen === null) return null;
  const wanted = squeezed(line).slice(0, READBACK_CHARS);
  return wanted !== '' && squeezed(screen).includes(wanted) ? wanted : null;
}

function squeezed(text: string): string {
  return text.replace(/\s+/g, FIELD_SEPARATOR).trim();
}

/** Long enough for a multiplexer to answer, short enough that a hung one never holds the voice. */
const RUN_TIMEOUT_MS = 3_000;

const NODE_SEAMS: PaneSeams = {
  run: (file, args) => {
    try {
      return execFileSync(file, [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: RUN_TIMEOUT_MS,
      });
    } catch {
      return null;
    }
  },
  pause: (ms) => sleep(ms),
};
