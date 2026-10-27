import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMNOX_HOME, JsonRecordDir } from '@memnox/core';
import { OPEN_BROWSER_VAR } from '../sync/browser';

/**
 * Any memnox command by voice: what reads runs at once, what changes waits for Touch ID, and a few
 * never run by voice. No shell is involved, so nothing said can become a second command.
 */

export const VOICE_RUN = {
  /** Reads only, so it runs as soon as it is asked for. */
  NOW: 'now',
  /** Changes something, so it waits for the person's Touch ID. */
  CONFIRM: 'confirm',
  NEVER: 'never',
} as const;

type VoiceRun = (typeof VOICE_RUN)[keyof typeof VOICE_RUN];

const READS: readonly string[] = [
  'scan',
  'status',
  'task',
  'repo',
  'explain',
  'paused',
  'claims',
  'budget',
  'next',
  'unattended',
  'report',
  'skills',
  'env',
  'approvals',
  'collisions',
  'why',
  'timeline',
  'replay',
  'policy',
  'whoami',
  'check',
  'trace',
  'traces',
  'doctor',
  'help',
];

const CHANGES: readonly string[] = [
  'mode',
  'allow',
  'setup',
  'stop',
  'start',
  'update',
  'protect',
  'freeze',
  'resume',
  'deny',
  'purge',
  'sync',
  'login',
  'logout',
  'lock',
  'rewind',
  'config',
  'agents',
  'mcp',
];

/** Why each of these is a person's to run at a terminal, said instead of running it. */
const NEVER_BY_VOICE: Readonly<Record<string, string>> = {
  approve:
    'A held call is answered with propose_answer, which puts exactly that call to Touch ID.',
  ask: 'That question is already being asked of this voice.',
  run: 'Starting an agent is propose_start, which opens it in its own terminal tab.',
  daemon:
    'The daemon is what this voice runs through, so restarting it would cut the conversation off.',
  watch: 'It runs until somebody stops it, which a voice cannot do.',
  uninstall: 'It removes Memnox, this voice included, so a person does it at a terminal.',
  voice: "The confirmation key is the person's to manage at a terminal.",
};

/**
 * Commands that wait on the person in a browser, so after Touch ID they run on their own and the
 * voice is told when they end, rather than holding the confirmation open for minutes.
 */
export function runsInBackground(argv: readonly string[]): boolean {
  return argv[0] === 'login' || (argv[0] === 'agents' && argv[1] === 'onboard');
}

/** Commands that list when given no subcommand or one of these, and change something otherwise. */
const LISTS_WHEN: Readonly<Record<string, (args: readonly string[]) => boolean>> = {
  lock: (args) => args.includes('--list'),
  rewind: (args) => args.includes('--list'),
  config: (args) =>
    args[0] === undefined || ['get', 'list', 'show', 'path'].includes(args[0]),
  agents: (args) => args[0] === undefined || ['list', 'show', 'status'].includes(args[0]),
  allow: (args) => args.includes('--list'),
  mcp: (args) => args[0] === undefined || ['status', 'list'].includes(args[0]),
};

/** Subcommands of a reading command that change what is in force, such as registering a rule file. */
const WRITING_SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  policy: ['use'],
  task: ['set', 'clear'],
  repo: ['trust'],
  budget: ['set', 'remove', 'suggest'],
};

function writesUnder(name: string, rest: readonly string[]): boolean {
  return rest[0] !== undefined && (WRITING_SUBCOMMANDS[name] ?? []).includes(rest[0]);
}

/** Flags that turn a reading command into one that writes, or sends something off this Mac. */
const CHANGING_FLAGS: readonly string[] = [
  '--fix',
  '--apply',
  '--save',
  '--write',
  '--reset',
  '--delete',
  '--forget',
  '--release',
  '--to',
  '--yes',
  '--otlp',
  '--prune',
];

interface VoiceCommand {
  argv: string[];
  run: VoiceRun;
  /** For a command that never runs by voice, the reason, to be said. */
  why?: string;
}

/** What was said, as arguments, and how it may run. "memnox" in front is the same command without it. */
export function voiceCommand(said: string): VoiceCommand | null {
  return voiceArguments(argumentsOf(said));
}

/** Already split into arguments, as a confirmed proposal holds them. */
export function voiceArguments(given: readonly string[]): VoiceCommand | null {
  const argv = given[0] === 'memnox' ? given.slice(1) : [...given];
  const [name, ...rest] = argv;
  if (name === undefined) return null;
  // How it addresses them is theirs to say out loud, and reaches nothing but the voice itself.
  if (name === 'voice' && rest[0] === 'address') return { argv, run: VOICE_RUN.NOW };
  const never = NEVER_BY_VOICE[name];
  if (never !== undefined) return { argv, run: VOICE_RUN.NEVER, why: never };
  const lists = LISTS_WHEN[name]?.(rest) ?? false;
  const changes = rest.some((arg) => CHANGING_FLAGS.includes(arg.split('=')[0] ?? arg));
  if ((READS.includes(name) || lists) && !changes && !writesUnder(name, rest))
    return { argv, run: VOICE_RUN.NOW };
  if (READS.includes(name) || CHANGES.includes(name))
    return { argv, run: VOICE_RUN.CONFIRM };
  return null;
}

/** Words split the way a shell splits them, quotes included, without a shell ever reading them. */
export function argumentsOf(said: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  for (const character of said.trim()) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) argv.push(current);
      current = '';
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (started) argv.push(current);
  return argv;
}

export interface CommandRun {
  exitCode: number;
  output: string;
}

/** Enough output to answer from; a whole report is read with a terminal. */
const MOST_OUTPUT_CHARS = 3_000;

/** memnox itself, run without a shell, colours off, and told nobody is at a terminal. */
export function runMemnox(
  argv: readonly string[],
  timeoutMs: number,
  mostChars: number = MOST_OUTPUT_CHARS,
): Promise<CommandRun> {
  const entry = cliEntry();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, ...argv],
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1_024 * 1_024,
        // A person asked out loud and is at the Mac, so a login's approval page opens for them.
        env: {
          ...process.env,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          TERM: 'dumb',
          [OPEN_BROWSER_VAR]: '1',
        },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ exitCode: code, output: plainOutput(`${stdout}${stderr}`, mostChars) });
      },
    );
  });
}

/** Without colour codes and box drawing, and cut to what can be answered from. */
function plainOutput(text: string, mostChars: number): string {
  // The escape character is built from its code, so no control character sits in the source.
  const escape = String.fromCharCode(27);
  const plain = text
    .replace(new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, 'g'), '')
    .replace(/[─│┌┐└┘├┤┬┴┼╭╮╰╯]/g, ' ');
  return plain.length <= mostChars ? plain : `${plain.slice(0, mostChars)}\n…`;
}

/** The memnox entry beside this module, wherever the bundler put it. */
function cliEntry(): string {
  const found = ['./index.js', '../index.js']
    .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
    .find((path) => existsSync(path));
  if (found === undefined)
    throw new Error('memnox itself could not be found beside the voice.');
  return found;
}

/** What a confirmed command printed, kept for the brain to read back once the person has confirmed. */
export interface CommandResult extends CommandRun {
  argv: string[];
  at: string;
  /** Set while one that runs on its own is still going, such as a login waiting on the browser. */
  running?: boolean;
  /** When it ended, so the end can be told once and only after the daemon started looking. */
  doneAt?: string;
}

export function commandResults(home: string): JsonRecordDir<CommandResult> {
  return new JsonRecordDir(join(home, MEMNOX_HOME, 'voice-commands'));
}
