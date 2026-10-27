import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LineBuffer, MEMNOX_HOME } from '@memnox/core';
import { BRAIN_CHUNK } from './brain';
import { brainEnv } from './claude-brain';
import { readStreamLine } from './claude-stream';
import {
  DICTATION_SYSTEM,
  dictationMessage,
  type DictationToPolish,
} from './dictation-prompt';

/**
 * The person's own Claude Code, logged in as they already are, kept warm for dictation alone: no tools, no MCP
 * server, no settings of theirs, and a quick model, apart from the voice's own conversation so a dictation never
 * lands in what the voice remembers. Nothing here holds a model credential; the CLI's own login does the work.
 */

/** Quick enough to keep up with somebody talking, which the person's default model is not built for. */
const DICTATION_MODEL = 'haiku';
/** A long run of dictations is let go, so earlier ones never weigh on the next and the process stays small. */
const MOST_TURNS = 30;
/** Unused this long, the process is ended, since it holds memory for nothing. */
const IDLE_MS = 10 * 60 * 1_000;
/** Longer than any dictation takes; past it the turn is given up and the process started fresh next time. */
const TURN_MS = 20_000;

export type Spawner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
) => ChildProcessWithoutNullStreams;

const spawnClaude: Spawner = (command, args, options) =>
  spawn(command, [...args], { ...options, stdio: ['pipe', 'pipe', 'pipe'] });

export class DictationBrain {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: string[] = [];
  private reader: ((line: string | null) => void) | null = null;
  private ended = false;
  private turns = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** One dictation at a time, since one process answers them in order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly home: string,
    private readonly spawner: Spawner = spawnClaude,
    private readonly command = 'claude',
  ) {}

  /** Started ahead of the words, as the key goes down, so the answer does not wait on a cold start. */
  async warm(): Promise<void> {
    await this.started();
  }

  /** The dictation as it should be typed, or null when the CLI is missing, failed or took too long. */
  polish(dictation: DictationToPolish): Promise<string | null> {
    const run = this.queue.then(() => this.turn(dictation));
    this.queue = run.catch(() => null);
    return run;
  }

  close(): void {
    this.child?.stdin.end();
    this.child?.kill('SIGTERM');
    this.child = null;
  }

  private async turn(dictation: DictationToPolish): Promise<string | null> {
    if (this.child !== null && this.turns >= MOST_TURNS) this.close();
    const child = await this.started();
    this.turns += 1;
    child.stdin.write(`${JSON.stringify(userTurn(dictationMessage(dictation)))}\n`);
    const deadline = setTimeout(() => this.close(), TURN_MS);
    try {
      let text = '';
      for (;;) {
        const line = await this.next();
        if (line === null) return null;
        for (const chunk of readStreamLine(line, text !== '').chunks) {
          if (chunk.kind === BRAIN_CHUNK.TEXT) text += chunk.text ?? '';
          else if (chunk.kind === BRAIN_CHUNK.DONE)
            return text.trim() === '' ? null : text.trim();
          else if (chunk.kind !== BRAIN_CHUNK.TOOL) return null;
        }
      }
    } finally {
      clearTimeout(deadline);
      this.keepAlive();
    }
  }

  private async started(): Promise<ChildProcessWithoutNullStreams> {
    this.keepAlive();
    if (this.child !== null) return this.child;
    // Somewhere with no project, so no project's memory or instructions ride along.
    const cwd = join(this.home, MEMNOX_HOME, 'dictation');
    await mkdir(cwd, { recursive: true });
    this.lines = [];
    this.ended = false;
    this.turns = 0;
    const child = this.spawner(this.command, dictationArgs(), {
      env: brainEnv(process.env),
      cwd,
    });
    const buffer = new LineBuffer();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) this.push(line);
    });
    child.on('close', () => {
      if (this.child === child) this.child = null;
      this.end();
    });
    // A missing binary surfaces as a turn with no answer, since `close` follows every spawn error.
    child.on('error', () => undefined);
    this.child = child;
    return child;
  }

  private keepAlive(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_MS);
    this.idle.unref();
  }

  private push(line: string): void {
    const read = this.reader;
    if (read === null) {
      this.lines.push(line);
      return;
    }
    this.reader = null;
    read(line);
  }

  private end(): void {
    this.ended = true;
    this.reader?.(null);
    this.reader = null;
  }

  private next(): Promise<string | null> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.reader = resolve;
    });
  }
}

/** Claude Code with every tool off and nothing of the person's settings: it can only write the text back. */
function dictationArgs(): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: {} }),
    '--setting-sources',
    'project',
    '--system-prompt',
    DICTATION_SYSTEM,
    '--model',
    DICTATION_MODEL,
  ];
}

function userTurn(text: string): unknown {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
}
