import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { LineBuffer, shortDigest } from '@memnox/core';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from './brain';
import { ACP_AUTH_REQUIRED, AcpConnection, isRecord } from './acp-connection';
import {
  readOnlyMode,
  readSessionUpdate,
  readStopReason,
  refusePermission,
} from './acp-stream';
import { brainEnv, OPERATOR_SERVER } from './claude-brain';
import { Conversations, MOST_CONVERSATION_TURNS } from './conversation';
import { unsealedNote, type VoiceBrainSpec } from './voice-brains';
import { voicePrompt } from './voice-prompts';

/**
 * The person's own agent as the voice's brain over the Agent Client Protocol. It gets no
 * files or terminal from Memnox, its read-only mode where it has one, and a refusal for
 * every permission it asks, so what acts goes through the operator tools and the gate.
 */

interface AcpBrainOptions {
  spec: VoiceBrainSpec;
  home: string;
  operator: { command: string; args: readonly string[] };
  /** The binary, where a test stands one in for the agent. */
  command?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Somewhere with no project, so no project instructions are read. */
  cwd?: string;
  vocabulary?: () => Promise<string[]>;
  address?: () => Promise<string | undefined>;
  name?: () => Promise<string | undefined>;
  catalogue?: () => Promise<string>;
  /** Told each session it opens, so the agent's own session list can leave the voice's out. */
  opened?: (sessionId: string) => Promise<void>;
}

/** A running agent with its session open. */
interface Live {
  child: ChildProcessWithoutNullStreams;
  connection: AcpConnection;
  sessionId: string;
  /** Whether the next prompt starts the conversation and so carries the voice's instructions. */
  fresh: boolean;
}

/** An agent that has not answered the handshake by now is not going to. */
const START_TIMEOUT_MS = 30_000;

/** How long an interrupted turn has to end before its process is ended instead. */
const INTERRUPT_GRACE_MS = 2_000;

/** Long enough for an agent to note its session ended, short enough that a stuck one is still stopped. */
const CLOSE_GRACE_MS = 1_000;

export class AcpBrain implements Brain {
  readonly name: string;
  private live: Promise<Live> | null = null;
  private turn: Turn | null = null;
  private readonly conversations: Conversations;
  private cancelled = false;
  private stopping: ReturnType<typeof setTimeout> | null = null;
  private turns = 0;

  constructor(private readonly options: AcpBrainOptions) {
    this.name = options.spec.label;
    this.conversations = new Conversations(options.home);
  }

  async *ask(said: string): AsyncIterable<BrainChunk> {
    this.cancelled = false;
    this.freshIfLong();
    let live: Live;
    try {
      live = await this.started();
    } catch (error) {
      yield { kind: BRAIN_CHUNK.FAILED, text: this.describe(error) };
      return;
    }
    const turn = new Turn(live.sessionId);
    this.turn = turn;
    this.turns += 1;
    const opening = live.fresh;
    live.fresh = false;
    if (opening && !this.options.spec.sealed) {
      yield { kind: BRAIN_CHUNK.TEXT, text: unsealedNote(this.options.spec) };
    }
    const prompt = await this.prompt(said, opening);
    live.connection.request('session/prompt', { sessionId: live.sessionId, prompt }).then(
      (result) => turn.end(readStopReason(result, this.name)),
      (error: unknown) =>
        turn.end(
          this.cancelled
            ? { kind: BRAIN_CHUNK.CANCELLED }
            : { kind: BRAIN_CHUNK.FAILED, text: this.describe(error) },
        ),
    );
    for (;;) {
      const chunk = await turn.next();
      const ends = chunk.kind !== BRAIN_CHUNK.TEXT && chunk.kind !== BRAIN_CHUNK.TOOL;
      if (ends) {
        this.settle();
        if (this.turn === turn) this.turn = null;
        if (chunk.kind === BRAIN_CHUNK.DONE) await this.keep(live.sessionId);
        yield this.cancelled ? { kind: BRAIN_CHUNK.CANCELLED } : chunk;
        return;
      }
      if (!this.cancelled) yield chunk;
    }
  }

  async warm(): Promise<void> {
    this.freshIfLong();
    await this.started();
  }

  close(): void {
    const live = this.live;
    this.live = null;
    void live?.then(
      (running) => endSession(running),
      () => undefined,
    );
  }

  /** Asks the turn to stop and keeps the process, ending it only should it not stop in time. */
  cancel(): void {
    const live = this.live;
    if (live === null || this.turn === null) return;
    this.cancelled = true;
    void live.then(
      (running) => {
        running.connection.notify('session/cancel', { sessionId: running.sessionId });
        this.stopping = setTimeout(() => {
          if (this.cancelled && this.turn !== null) running.child.kill('SIGTERM');
        }, INTERRUPT_GRACE_MS);
        this.stopping.unref();
      },
      () => undefined,
    );
  }

  private freshIfLong(): void {
    if (this.live !== null && this.turns >= MOST_CONVERSATION_TURNS) this.close();
  }

  private settle(): void {
    if (this.stopping !== null) clearTimeout(this.stopping);
    this.stopping = null;
  }

  private started(): Promise<Live> {
    if (this.live !== null) return this.live;
    const live = this.start();
    this.live = live;
    // A start that failed is forgotten, so the next question tries again rather than inherits it.
    live.catch(() => {
      if (this.live === live) this.live = null;
    });
    return live;
  }

  private async start(): Promise<Live> {
    const { spec } = this.options;
    const child = spawn(this.options.command ?? spec.command, [...spec.args], {
      env: brainEnv(this.options.env ?? process.env),
      ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const connection = new AcpConnection((line) => child.stdin.write(line), {
      notify: (method, params) => {
        if (method === 'session/update') this.turn?.update(params);
      },
      request: (method, params) =>
        method === 'session/request_permission' ? refusePermission(params) : null,
    });
    const buffer = new LineBuffer();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) connection.receive(line);
    });
    // Drained and dropped: an agent's own logging fills the pipe and stalls it otherwise.
    child.stderr.resume();
    const gone = (because: string): void => {
      connection.end(new Error(because));
      if (this.live !== null) this.live = null;
    };
    child.on('error', () => gone(`${spec.label} is not installed here: ${spec.install}`));
    child.on('close', () => gone(`${spec.label} stopped before it answered`));
    try {
      return await withTimeout(
        this.open(child, connection),
        START_TIMEOUT_MS,
        spec.label,
      );
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }
  }

  /** The handshake, then the conversation to carry on or a new one, then the read-only mode. */
  private async open(
    child: ChildProcessWithoutNullStreams,
    connection: AcpConnection,
  ): Promise<Live> {
    const { spec } = this.options;
    const ready = await connection.request('initialize', {
      protocolVersion: 1,
      // Nothing of this machine is offered: no files and no terminal through the client.
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'memnox', version: '1' },
    });
    const cwd = this.options.cwd ?? process.cwd();
    const mcpServers = spec.sessionTools ? [this.operatorServer()] : [];
    const resumed = await this.resume(connection, ready, cwd, mcpServers);
    const session =
      resumed?.session ?? (await connection.request('session/new', { cwd, mcpServers }));
    const sessionId = resumed?.sessionId ?? readSessionId(session);
    if (sessionId === null) throw new Error(`${spec.label} opened no session`);
    // Noting it is bookkeeping for a list elsewhere, so a home that cannot be written never stops the answer.
    await this.options.opened?.(sessionId).catch(() => undefined);
    if (resumed === null) this.turns = 0;
    const mode = readOnlyMode(session, spec.readOnlyModes);
    if (mode !== null) {
      await connection.request('session/set_mode', { sessionId, modeId: mode });
    } else if (spec.sealed) {
      throw new Error(
        `${spec.label} offered no read-only mode, so it cannot be the voice`,
      );
    }
    return { child, connection, sessionId, fresh: resumed === null };
  }

  /** Carries on the conversation from minutes ago where the agent can, and null where it cannot. */
  private async resume(
    connection: AcpConnection,
    ready: unknown,
    cwd: string,
    mcpServers: unknown[],
  ): Promise<{ session: unknown; sessionId: string } | null> {
    if (!canLoad(ready)) return null;
    const kept = await this.conversations.resumable(
      this.name,
      this.now(),
      this.version(),
    );
    if (kept === null) return null;
    try {
      const loaded = await connection.request('session/load', {
        sessionId: kept.sessionId,
        cwd,
        mcpServers,
      });
      this.turns = kept.turns;
      return { session: loaded, sessionId: kept.sessionId };
    } catch {
      // A session the agent has forgotten starts fresh, with recall carrying the thread.
      return null;
    }
  }

  private operatorServer(): unknown {
    return {
      name: OPERATOR_SERVER,
      command: this.options.operator.command,
      args: [...this.options.operator.args],
      env: [],
    };
  }

  /** The voice's instructions ride on the first prompt, since the protocol has no system prompt. */
  private async prompt(said: string, opening: boolean): Promise<unknown[]> {
    if (!opening) return [{ type: 'text', text: said }];
    const words = (await this.options.vocabulary?.().catch(() => [])) ?? [];
    const address = await this.options.address?.().catch(() => undefined);
    const name = await this.options.name?.().catch(() => undefined);
    const catalogue = (await this.options.catalogue?.().catch(() => '')) ?? '';
    return [
      { type: 'text', text: voicePrompt(words, address, catalogue, name) },
      { type: 'text', text: said },
    ];
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

  private version(): string {
    return shortDigest(`${voicePrompt()}|${this.options.spec.kind}`);
  }

  private describe(error: unknown): string {
    if (!(error instanceof Error)) return `${this.name} failed`;
    if (error.cause === ACP_AUTH_REQUIRED) {
      return `${this.name} is not logged in: ${this.options.spec.install}`;
    }
    return error.message;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

/** What one prompt streams, read by the turn that asked it. */
class Turn {
  private readonly waiting: BrainChunk[] = [];
  private reader: ((chunk: BrainChunk) => void) | null = null;
  private finished = false;
  private readonly announced = new Set<string>();

  constructor(private readonly sessionId: string) {}

  update(params: unknown): void {
    for (const chunk of readSessionUpdate(params, this.sessionId, this.announced)) {
      this.push(chunk);
    }
  }

  end(chunk: BrainChunk): void {
    if (this.finished) return;
    this.push(chunk);
    this.finished = true;
  }

  next(): Promise<BrainChunk> {
    const chunk = this.waiting.shift();
    if (chunk !== undefined) return Promise.resolve(chunk);
    return new Promise((resolve) => {
      this.reader = resolve;
    });
  }

  private push(chunk: BrainChunk): void {
    if (this.finished) return;
    const read = this.reader;
    if (read === null) {
      this.waiting.push(chunk);
      return;
    }
    this.reader = null;
    read(chunk);
  }
}

/**
 * Asks the agent to close the session before its process is stopped, so it records the session
 * as ended rather than leaving it open in its own list; one that does not answer in time is stopped anyway.
 */
async function endSession(running: Live): Promise<void> {
  const closed = running.connection
    .request('session/close', { sessionId: running.sessionId })
    .catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_GRACE_MS);
    timer.unref();
  });
  await Promise.race([closed, late]);
  clearTimeout(timer);
  running.child.kill('SIGTERM');
}

function readSessionId(session: unknown): string | null {
  const id = isRecord(session) ? session['sessionId'] : undefined;
  return typeof id === 'string' ? id : null;
}

function canLoad(ready: unknown): boolean {
  const capabilities = isRecord(ready) ? ready['agentCapabilities'] : undefined;
  return isRecord(capabilities) && capabilities['loadSession'] === true;
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not start within ${ms / 1_000} seconds`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
