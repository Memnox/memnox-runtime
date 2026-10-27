import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  LineBuffer,
  MCP_PROTOCOL_VERSION,
  secondsToMs,
  type McpToolDeclaration,
  type ServerLaunch,
} from '@memnox/core';

/**
 * One MCP server on this Mac, started with the very launch line and environment its agent's config
 * gives it, spoken to over stdio, and kept running a little while so the next question reuses it.
 * The environment is handed to the child and nowhere else: it is never printed, logged or kept.
 */

const CALL_TIMEOUT_MS = secondsToMs(20);
const START_TIMEOUT_MS = secondsToMs(8);
/** How long an unused server stays up, so a follow up question does not start it again. */
const IDLE_MS = secondsToMs(120);
/** A line longer than this is no message a person asked for. */
const MOST_LINE_CHARS = 8_000_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** What starts a server, so a test speaks to a fake one. */
type StartServer = (launch: ServerLaunch) => ChildProcess;

const startServer: StartServer = (launch) =>
  spawn(launch.command, [...launch.args], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...(launch.env ?? {}) },
  });

class McpSession {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly child: ChildProcess) {
    const buffer = new LineBuffer(MOST_LINE_CHARS);
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of buffer.push(chunk.toString('utf8'))) this.receive(line);
    });
    child.on('exit', () => this.fail('the server stopped'));
    child.on('error', () => this.fail('the server could not be started'));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async tools(): Promise<McpToolDeclaration[]> {
    await this.initialized();
    const answer = await this.request('tools/list', {}, START_TIMEOUT_MS);
    const tools = (answer as { tools?: unknown } | null)?.tools;
    return Array.isArray(tools) ? (tools as McpToolDeclaration[]) : []; // shape checked by the caller per field
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialized();
    return this.request('tools/call', { name, arguments: args }, CALL_TIMEOUT_MS);
  }

  close(): void {
    this.fail('closed');
    this.child.kill();
  }

  private initialized(): Promise<void> {
    this.ready ??= this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'memnox', version: '1' },
      },
      START_TIMEOUT_MS,
    ).then(() => this.notify('notifications/initialized'));
    return this.ready;
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('the server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('the server did not answer in time'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin?.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });
  }

  private notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  private receive(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
    try {
      message = JSON.parse(line) as typeof message; // fields read one by one below
    } catch {
      // A server's stray log line on stdout is not an answer.
      return;
    }
    if (typeof message.id !== 'number') return;
    const waiting = this.pending.get(message.id);
    if (waiting === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error !== undefined) {
      const said = message.error.message;
      waiting.reject(
        new Error(typeof said === 'string' ? said : 'the server refused it'),
      );
      return;
    }
    waiting.resolve(message.result ?? null);
  }

  private fail(why: string): void {
    this.closed = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(why));
    }
    this.pending.clear();
  }
}

/** Running servers by name, each closed once it has been idle a while. */
export class McpPool {
  private readonly running = new Map<
    string,
    { session: McpSession; idle: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly start: StartServer = startServer) {}

  /** The server's running session, reused while it is up and its launch line unchanged, else started from it. */
  session(name: string, launch: ServerLaunch): McpSession {
    // Keyed on a hash of the whole line, so an edited config starts afresh and no secret is held as a key.
    const key = `${name}:${createHash('sha256').update(JSON.stringify(launch)).digest('hex')}`;
    const found = this.running.get(key);
    if (found !== undefined && !found.session.isClosed) {
      found.idle.refresh();
      return found.session;
    }
    const session = new McpSession(this.start(launch));
    if (found !== undefined) this.stop(key);
    const idle = setTimeout(() => this.stop(key), IDLE_MS);
    idle.unref();
    this.running.set(key, { session, idle });
    return session;
  }

  private stop(key: string): void {
    const found = this.running.get(key);
    if (found === undefined) return;
    clearTimeout(found.idle);
    found.session.close();
    this.running.delete(key);
  }

  closeAll(): void {
    for (const key of [...this.running.keys()]) this.stop(key);
  }
}
