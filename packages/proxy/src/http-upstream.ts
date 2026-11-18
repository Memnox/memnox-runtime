import {
  carriesCredential,
  SERVER_TROUBLE,
  troubleForAgent,
  troubleOfStatus,
  type ServerTroubleKind,
} from '@memnox/core';
import { isJsonRpcMessage, parseIncoming, type JsonRpcMessage } from './json-rpc';
import type { RemoteServer } from './firewall-options';

/**
 * A streamable HTTP MCP server as the firewall's upstream. Each message the agent writes is
 * posted, and every message an answer carries comes back as one line, as a stdio server writes
 * it, so the firewall rules on a remote server exactly as it rules on a local one.
 */

const SESSION_HEADER = 'mcp-session-id';
const VERSION_HEADER = 'mcp-protocol-version';
const EVENT_STREAM = 'text/event-stream';
const JSON_TYPE = 'application/json';
const INITIALIZE = 'initialize';

/** The status a server answers when it wants a sign in, or will not take the one it was sent. */
const UNAUTHORIZED = 401;

/** A JSON-RPC code in the range left to servers, for a call the remote server never answered. */
const UNREACHABLE_CODE = -32000;

/** The most one answer may carry, so a server cannot fill the proxy's memory with one reply. */
export const MOST_RESPONSE_BYTES = 8 * 1024 * 1024;

/** How long one request may take end to end, a slow tool included, before it is given up. */
export const RESPONSE_TIMEOUT_MS = 5 * 60 * 1_000;

/** How long closing waits for the server to let the session go. */
const CLOSE_TIMEOUT_MS = 5_000;

type Fetch = typeof fetch;

/** A request the server never answered: what that means for a person, and whether it was the opening one. */
export interface UpstreamFailure {
  kind: ServerTroubleKind;
  opening: boolean;
}

/** A sign in kept for the server: the token to send, and another where that one is refused. */
export interface UpstreamSignIn {
  token(): Promise<string | undefined>;
  renew(refused: string): Promise<string | undefined>;
}

const AUTHORIZATION = 'authorization';
const BEARER = 'Bearer ';

export interface HttpUpstreamOptions extends RemoteServer {
  /** The server's name, which is all an error says about where it went. */
  name: string;
  /** One message the server sent, as a line without its newline. */
  onLine: (line: string) => void;
  /** Never handed a header value, so a credential cannot reach a log. */
  log: (message: string) => void;
  /** The sign in Memnox holds for it, sent where the headers carry no credential of their own. */
  signIn?: UpstreamSignIn;
  /** Told each time a request is not answered, so whoever started this can say why to a person. */
  onFailure?: (failure: UpstreamFailure) => void;
  /** Told each time one is, so trouble written down earlier is known to be over. */
  onReached?: () => void;
  fetch?: Fetch;
  timeoutMs?: number;
  mostResponseBytes?: number;
}

/** Request ids a post still owes an answer to, so a failure answers each of them. */
type Owed = Set<string | number>;

export class HttpUpstream {
  private session: string | undefined;
  private version: string | undefined;
  /** Everything after initialize waits for it, since only its answer names the session. */
  private ready: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<Promise<void>>();
  private closed = false;

  constructor(private readonly options: HttpUpstreamOptions) {}

  /** Posts one payload in the background; false once the upstream is closed, as a dead pipe is. */
  send(payload: string): boolean {
    if (this.closed) return false;
    const incoming = parseIncoming(payload.trim());
    const messages = incoming === null ? [] : messagesOf(incoming);
    const owed = new Set(messages.flatMap(requestIdOf));
    const opening = messages.some((message) => message.method === INITIALIZE);
    const posted = opening
      ? this.post(payload, owed, true)
      : this.ready.then(() => this.post(payload, owed, false));
    if (opening) this.ready = posted;
    this.inFlight.add(posted);
    void posted.finally(() => this.inFlight.delete(posted));
    return true;
  }

  /** Waits for answers already on their way, then tells the server the session is over. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.inFlight]);
    if (this.session === undefined) return;
    const token = await this.bearer();
    await this.request('DELETE', undefined, CLOSE_TIMEOUT_MS, token)
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  }

  private async post(payload: string, owed: Owed, opening: boolean): Promise<void> {
    const timeout = this.options.timeoutMs ?? RESPONSE_TIMEOUT_MS;
    try {
      const response = await this.signedIn(payload, timeout);
      const named = response.headers.get(SESSION_HEADER);
      if (named !== null) this.session = named;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        this.options.onFailure?.({ kind: this.troubleOf(response.status), opening });
        return this.failed(owed, `answered ${response.status}`, response.status);
      }
      this.options.onReached?.();
      await this.read(response, owed);
      if (owed.size > 0) this.failed(owed, 'closed its answer without replying');
    } catch (error) {
      this.options.onFailure?.({ kind: SERVER_TROUBLE.UNREACHABLE, opening });
      this.failed(owed, reasonOf(error));
    }
  }

  /** The post with the kept sign in on it, sent once more with a renewed token where the first is refused. */
  private async signedIn(payload: string, timeoutMs: number): Promise<Response> {
    const token = await this.bearer();
    const response = await this.request('POST', payload, timeoutMs, token);
    if (response.status !== UNAUTHORIZED || token === undefined) return response;
    const fresh = await this.options.signIn?.renew(token).catch(() => undefined);
    if (fresh === undefined) return response;
    await response.body?.cancel().catch(() => undefined);
    return this.request('POST', payload, timeoutMs, fresh);
  }

  /** Undefined where the headers already carry a credential, which then is the one that speaks. */
  private async bearer(): Promise<string | undefined> {
    if (carriesCredential(this.options.headers)) return undefined;
    return this.options.signIn?.token().catch(() => undefined);
  }

  private async request(
    method: 'POST' | 'DELETE',
    body: string | undefined,
    timeoutMs: number,
    token?: string,
  ): Promise<Response> {
    const fetcher = this.options.fetch ?? fetch;
    return fetcher(this.options.url, {
      method,
      headers: {
        ...this.headers(),
        ...(token === undefined ? {} : { [AUTHORIZATION]: `${BEARER}${token}` }),
      },
      ...(body === undefined ? {} : { body }),
      // A credential header never follows a redirect to wherever the server points.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private troubleOf(status: number | undefined): ServerTroubleKind {
    return troubleOfStatus(status, carriesCredential(this.options.headers));
  }

  private headers(): Record<string, string> {
    return {
      ...this.options.headers,
      'content-type': JSON_TYPE,
      accept: `${JSON_TYPE}, ${EVENT_STREAM}`,
      ...(this.session === undefined ? {} : { [SESSION_HEADER]: this.session }),
      ...(this.version === undefined ? {} : { [VERSION_HEADER]: this.version }),
    };
  }

  /** Each message the answer carries, read as it arrives and never past the bound. */
  private async read(response: Response, owed: Owed): Promise<void> {
    const stream = response.body;
    if (stream === null) return;
    const events = (response.headers.get('content-type') ?? '').includes(EVENT_STREAM);
    const most = this.options.mostResponseBytes ?? MOST_RESPONSE_BYTES;
    const decoder = new TextDecoder();
    const framing = new EventFraming();
    let text = '';
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      if (bytes > most) {
        await stream.cancel().catch(() => undefined);
        throw new Error(`sent an answer over ${most} bytes`);
      }
      const decoded = decoder.decode(chunk, { stream: true });
      if (events) framing.push(decoded).forEach((data) => this.deliver(data, owed));
      else text += decoded;
    }
    if (events) framing.end().forEach((data) => this.deliver(data, owed));
    else this.deliver(text + decoder.decode(), owed);
  }

  private deliver(data: string, owed: Owed): void {
    const incoming = data.trim() === '' ? null : parseIncoming(data.trim());
    if (incoming === null) return;
    for (const message of messagesOf(incoming)) {
      const version = message.result?.['protocolVersion'];
      if (typeof version === 'string') this.version = version;
      if (message.method === undefined && message.id !== undefined && message.id !== null)
        owed.delete(message.id);
    }
    this.options.onLine(JSON.stringify(incoming));
  }

  /**
   * Each request still owed is answered with the reason, by the server's name and never its headers. A
   * sign in or a refused credential is said as that, since the agent's server list is where a person looks.
   */
  private failed(owed: Owed, why: string, status?: number): void {
    this.options.log(`${this.options.name} ${why}`);
    const kind = this.troubleOf(status);
    const reason =
      kind === SERVER_TROUBLE.UNREACHABLE
        ? `${this.options.name} ${why}`
        : troubleForAgent(this.options.name, kind);
    for (const id of owed) {
      const answer: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        error: {
          code: UNREACHABLE_CODE,
          message: reason,
          ...(status === undefined ? {} : { data: { status } }),
        },
      };
      this.options.onLine(JSON.stringify(answer));
    }
    owed.clear();
  }
}

function messagesOf(incoming: JsonRpcMessage | readonly unknown[]): JsonRpcMessage[] {
  return isJsonRpcMessage(incoming) ? [incoming] : incoming.filter(isJsonRpcMessage);
}

/** A request is owed an answer; a notification or a response is not. */
function requestIdOf(message: JsonRpcMessage): (string | number)[] {
  const id = message.id;
  if (message.method === undefined || id === undefined || id === null) return [];
  return [id];
}

/** What went wrong, in words that hold no header: a timeout, a refusal, or the error's own message. */
function reasonOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'did not answer in time';
  return `could not be reached: ${error instanceof Error ? error.message : String(error)}`;
}

/** Server-sent events cut into their data, an event at a time, as the format joins its lines. */
export class EventFraming {
  private buffer = '';

  push(text: string): string[] {
    this.buffer += text.replace(/\r\n?/g, '\n');
    const events = this.buffer.split('\n\n');
    this.buffer = events.pop() ?? '';
    return events.map(dataOf).filter((data) => data !== '');
  }

  end(): string[] {
    const last = dataOf(this.buffer);
    this.buffer = '';
    return last === '' ? [] : [last];
  }
}

function dataOf(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n');
}
