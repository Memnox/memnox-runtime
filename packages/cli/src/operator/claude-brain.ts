import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ENV_AGENT_NAME, LineBuffer, SESSION_VAR, shortDigest } from '@memnox/core';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from './brain';
import { readStreamLine } from './claude-stream';
import { Conversations, MOST_CONVERSATION_TURNS, type Resumable } from './conversation';
import { voicePrompt } from './voice-prompts';

/**
 * The person's own Claude Code as the voice's brain, kept warm for a conversation. It runs
 * with every built-in tool switched off and one MCP server, so it can read the machine and
 * propose, and can never edit a file or run a command.
 */

export const OPERATOR_SERVER = 'memnox-operator';

/** Whose record the brain's own session goes on, so it is never mistaken for work. */
const OPERATOR_AGENT_NAME = 'memnox-operator';

interface ClaudeBrainOptions {
  home: string;
  /** How the operator MCP server is started, which is this install's own binary. */
  operator: { command: string; args: readonly string[] };
  command?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** A model built for quick talk rather than the person's default, which is built for depth. */
  model?: string;
  effort?: string;
  /** Where the process starts: somewhere with no project, so no project memory is read. */
  cwd?: string;
  /** The names this machine uses, read when the brain starts, so misheard ones are understood. */
  vocabulary?: () => Promise<string[]>;
  /** How the person asked to be addressed, read when the brain starts; undefined is no honorific. */
  address?: () => Promise<string | undefined>;
  /** Their name, said far less often than the address and only once they chose an address at all. */
  name?: () => Promise<string | undefined>;
  /** Every memnox command, one line each, so the brain knows all it can run before it is asked. */
  catalogue?: () => Promise<string>;
}

export class ClaudeCodeBrain implements Brain {
  readonly name = 'claude';
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines = new LineQueue();
  private readonly conversations: Conversations;
  /** Set by cancel, so the process ending reads as stopped rather than as a crash. */
  private cancelled = false;
  private stopping: ReturnType<typeof setTimeout> | null = null;
  /** Questions in the conversation this process carries, resumed ones included. */
  private turns = 0;

  constructor(private readonly options: ClaudeBrainOptions) {
    this.conversations = new Conversations(options.home);
  }

  async *ask(said: string): AsyncIterable<BrainChunk> {
    this.cancelled = false;
    this.freshIfLong();
    const child = await this.started();
    this.turns += 1;
    child.stdin.write(`${JSON.stringify(userTurn(said))}\n`);
    let spoke = false;
    const announced = new Set<string>();
    for (;;) {
      const line = await this.lines.next();
      if (line === null) {
        yield this.cancelled
          ? { kind: BRAIN_CHUNK.CANCELLED }
          : { kind: BRAIN_CHUNK.FAILED, text: 'Claude Code stopped before it answered' };
        return;
      }
      const read = readStreamLine(line, spoke, announced);
      if (read.sessionId !== undefined) await this.keep(read.sessionId);
      for (const chunk of read.chunks) {
        const ends = chunk.kind !== BRAIN_CHUNK.TEXT && chunk.kind !== BRAIN_CHUNK.TOOL;
        // An interrupted turn ends with a result like any other, which is a stop and not a fault.
        if (ends && this.cancelled) {
          this.settle();
          yield { kind: BRAIN_CHUNK.CANCELLED };
          return;
        }
        if (this.cancelled) continue;
        if (chunk.kind === BRAIN_CHUNK.TEXT) spoke = true;
        yield chunk;
        if (ends) return;
      }
    }
  }

  /** Starts the process ahead of the question, so the answer does not wait on a cold start. */
  async warm(): Promise<void> {
    this.freshIfLong();
    await this.started();
  }

  close(): void {
    this.child?.stdin.end();
    this.child = null;
  }

  /**
   * Asks the turn to stop and keeps the process, since starting it again costs the next answer
   * several seconds. Should it not stop in time it is ended, and the conversation resumes from
   * what it saved.
   */
  cancel(): void {
    const child = this.child;
    if (child === null) return;
    this.cancelled = true;
    child.stdin.write(`${JSON.stringify(interrupt())}\n`);
    this.stopping = setTimeout(() => {
      if (this.child === child && this.cancelled) child.kill('SIGTERM');
    }, INTERRUPT_GRACE_MS);
    this.stopping.unref();
  }

  /** A long conversation is let go here, while they are still talking, so the cold start hides under it. */
  private freshIfLong(): void {
    if (this.child !== null && this.turns >= MOST_CONVERSATION_TURNS) this.close();
  }

  /** The interrupted turn has ended, so nothing needs ending by force. */
  private settle(): void {
    if (this.stopping !== null) clearTimeout(this.stopping);
    this.stopping = null;
  }

  private async started(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child !== null) return this.child;
    const resume = await this.conversations.resumable(
      this.name,
      this.now(),
      this.version(),
    );
    this.turns = resume?.turns ?? 0;
    const words = (await this.options.vocabulary?.().catch(() => [])) ?? [];
    const address = await this.options.address?.().catch(() => undefined);
    const name = await this.options.name?.().catch(() => undefined);
    const catalogue = (await this.options.catalogue?.().catch(() => '')) ?? '';
    // A fresh queue per process, since the last one ended when its process did.
    const lines = new LineQueue();
    this.lines = lines;
    const child = spawn(
      this.options.command ?? 'claude',
      claudeArgs(this.options, resume, { words, address, name, catalogue }),
      {
        env: brainEnv(this.options.env ?? process.env),
        ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const buffer = new LineBuffer();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) lines.push(line);
    });
    child.on('close', () => {
      if (this.child === child) this.child = null;
      lines.end();
    });
    // A missing binary surfaces as a failed turn, since `close` follows every spawn error.
    child.on('error', () => undefined);
    this.child = child;
    return child;
  }

  private async keep(sessionId: string): Promise<void> {
    try {
      await this.conversations.keep(
        this.name,
        sessionId,
        this.now(),
        this.version(),
        this.turns,
      );
    } catch {
      // Resuming is a convenience: a home that cannot be written loses the follow up, never the answer.
    }
  }

  /** The instructions and model together: change either and the next question starts fresh. */
  private version(): string {
    return shortDigest(
      `${voicePrompt()}|${this.options.model ?? ''}|${this.options.effort ?? ''}`,
    );
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

/** The flags that make Claude Code a brain that reads and proposes and does nothing else. */
function claudeArgs(
  options: ClaudeBrainOptions,
  resume: Resumable | null,
  spoken: Spoken,
): string[] {
  const servers = {
    mcpServers: {
      [OPERATOR_SERVER]: {
        command: options.operator.command,
        args: options.operator.args,
      },
    },
  };
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Every built-in tool off: no Bash, no Edit, no Write, no web.
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(servers),
    '--allowedTools',
    `mcp__${OPERATOR_SERVER}`,
    ...voiceFlags(options, spoken),
    ...(resume === null ? [] : ['--resume', resume.sessionId]),
  ];
}

/** What the prompt is shaped by on this machine: the names said here, and how the person is addressed. */
interface Spoken {
  words: readonly string[];
  address: string | undefined;
  name?: string | undefined;
  catalogue: string;
}

/** How the brain talks: its own instructions, no settings of the person's, and a quick model. */
function voiceFlags(options: ClaudeBrainOptions, spoken: Spoken): string[] {
  return [
    // Replaces Claude Code's own coding prompt rather than adding to it, since that one asks
    // for thorough written answers and a voice needs one spoken sentence.
    '--system-prompt',
    voicePrompt(spoken.words, spoken.address, spoken.catalogue, spoken.name),
    // Only a project's settings, and the brain starts where there is no project: no hooks on
    // every tool call, and nothing of the person's own memory or instructions rides along.
    '--setting-sources',
    'project',
    ...(options.model === undefined ? [] : ['--model', options.model]),
    ...(options.effort === undefined ? [] : ['--effort', options.effort]),
  ];
}

/** Claude Code's own setting for how much it thinks before answering; zero is none. */
const THINKING_BUDGET_VAR = 'MAX_THINKING_TOKENS';

/** How long an interrupted turn has to end before its process is ended instead. */
const INTERRUPT_GRACE_MS = 2_000;

/** The stream's own request to stop the turn in flight, as the Agent SDK sends it. */
function interrupt(): unknown {
  return {
    type: 'control_request',
    request_id: `interrupt_${Date.now().toString(36)}`,
    request: { subtype: 'interrupt' },
  };
}

function userTurn(said: string): unknown {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: said }] },
  };
}

/** The person's own login, with the brain recorded as the operator and never as their work. */
export function brainEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    ...env,
    [ENV_AGENT_NAME]: OPERATOR_AGENT_NAME,
    // Thinking first cost every spoken answer five to fifteen seconds for one sentence from tools.
    [THINKING_BUDGET_VAR]: '0',
  };
  delete out[SESSION_VAR];
  return out;
}

/** Lines that outlive one turn, since the process is warm across the conversation. */
class LineQueue {
  private readonly waiting: string[] = [];
  private reader: ((line: string | null) => void) | null = null;
  private ended = false;

  push(line: string): void {
    if (this.reader === null) {
      this.waiting.push(line);
      return;
    }
    const read = this.reader;
    this.reader = null;
    read(line);
  }

  end(): void {
    this.ended = true;
    this.reader?.(null);
    this.reader = null;
  }

  next(): Promise<string | null> {
    const line = this.waiting.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.reader = resolve;
    });
  }
}
