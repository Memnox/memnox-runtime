import { MAILBOX_BYTES, MOST_RELAY_MESSAGE } from './framing';

/**
 * The machine's one outbound WebSocket to the blind relay, beside `sync/client.ts` as the only
 * other module that reaches a network. It carries ciphertext by mailbox and trusts nothing it hears.
 */

export const RELAY_URL = 'wss://api.memnox.com/v1/relay';

/** A local relay for tests and development, as the contract allows. */
const RELAY_URL_VAR = 'MEMNOX_RELAY_URL';

const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 60_000;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The part of a WebSocket the link uses, so a test hands in a pipe instead of a network. */
export interface RelaySocket {
  send(data: Buffer): void;
  close(): void;
  on(event: 'open' | 'close', listener: () => void): void;
  /** `text` is a text message, which only the relay itself sends, as UTF-8 bytes. */
  on(event: 'message' | 'text', listener: (data: Buffer) => void): void;
}

/** The relay's one word to this machine: something here waits on the control plane, so beat now. */
const RELAY_BEAT = 'beat';

/** Whether a text message from the relay is a beat; anything else from it is ignored. */
export function isBeatFrame(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === RELAY_BEAT
    );
  } catch {
    return false;
  }
}

export type OpenRelay = (url: string, token: string) => RelaySocket;

interface RelayLinkDeps {
  url: string;
  /** The machine's `mch_` token, which only lets it put bytes into its own mailboxes. */
  token: string;
  onFrame: (mailbox: string, payload: Buffer) => void;
  /** The control plane says an answer waits for this machine, so the heartbeat should run now. */
  onBeat?: () => void;
  /** The socket dropped, so every session through it is gone. */
  onDown: () => void;
  log: (message: string) => void;
  open?: OpenRelay;
  /** A number in [0, 1), handed in so a test can pin the jitter. */
  random?: () => number;
}

/** Half the backoff fixed and half random, so machines dropped together by a relay drain come back spread out. */
export function jitteredRetryMs(retryMs: number, random: () => number): number {
  return Math.round(retryMs / 2 + random() * (retryMs / 2));
}

export function relayUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env[RELAY_URL_VAR] ?? RELAY_URL;
}

/** Refused rather than downgraded, since the token travels in a header: wss, or ws to this machine only. */
export function insecureRelayUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'wss:') return null;
    if (parsed.protocol === 'ws:' && LOOPBACK.has(parsed.hostname)) return null;
    return `${url} is not wss, and a token must not travel in the clear`;
  } catch {
    return `"${url}" is not a URL`;
  }
}

export class RelayLink {
  private socket: RelaySocket | null = null;
  private up = false;
  private stopped = true;
  private retryMs = FIRST_RETRY_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: RelayLinkDeps) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.up = false;
  }

  isUp(): boolean {
    return this.up;
  }

  /** False when the relay is down or the message is past its size, so the caller knows it was not sent. */
  send(mailbox: string, payload: Buffer): boolean {
    const id = Buffer.from(mailbox, 'base64url');
    if (!this.up || this.socket === null || id.length !== MAILBOX_BYTES) return false;
    const message = Buffer.concat([id, payload]);
    if (message.length > MOST_RELAY_MESSAGE) return false;
    this.socket.send(message);
    return true;
  }

  private connect(): void {
    const insecure = insecureRelayUrl(this.deps.url);
    if (insecure !== null) {
      this.deps.log(`the relay was not reached: ${insecure}`);
      return;
    }
    const socket = (this.deps.open ?? openWebSocket)(this.deps.url, this.deps.token);
    this.socket = socket;
    socket.on('open', () => {
      this.up = true;
      this.retryMs = FIRST_RETRY_MS;
    });
    socket.on('message', (data) => this.receive(data));
    socket.on('text', (data) => {
      if (isBeatFrame(data.toString('utf8'))) this.deps.onBeat?.();
    });
    socket.on('close', () => this.dropped(socket));
  }

  private receive(data: Buffer): void {
    if (data.length <= MAILBOX_BYTES || data.length > MOST_RELAY_MESSAGE) return;
    const mailbox = data.subarray(0, MAILBOX_BYTES).toString('base64url');
    this.deps.onFrame(mailbox, data.subarray(MAILBOX_BYTES));
  }

  /** Down means every session through it is gone; back off and try again unless asked to stop. */
  private dropped(socket: RelaySocket): void {
    if (this.socket !== socket) return;
    const wasUp = this.up;
    this.up = false;
    this.socket = null;
    if (wasUp) this.deps.onDown();
    if (this.stopped) return;
    const delay = jitteredRetryMs(this.retryMs, this.deps.random ?? Math.random);
    this.timer = setTimeout(() => this.connect(), delay);
    // A relay that is away is never a reason to keep a daemon alive that was asked to stop.
    this.timer.unref();
    this.retryMs = Math.min(this.retryMs * 2, LONGEST_RETRY_MS);
  }
}

/** The WebSocket Node ships, whose constructor takes headers, which the bundled types do not declare. */
interface NodeWebSocket {
  binaryType: string;
  send(data: Buffer): void;
  close(): void;
  addEventListener(event: string, listener: (event: { data?: unknown }) => void): void;
}

type NodeWebSocketClass = new (
  url: string,
  init: { headers: Record<string, string> },
) => NodeWebSocket;

function openWebSocket(url: string, token: string): RelaySocket {
  // Global since Node 22; @types/node 20 predates it, so it is reached through globalThis.
  const Socket = (globalThis as unknown as { WebSocket: NodeWebSocketClass }).WebSocket;
  const socket = new Socket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.binaryType = 'arraybuffer';
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    on: (event: string, listener: (data: Buffer) => void) => {
      // Text and binary arrive as one event; the relay's control frames are the only text.
      socket.addEventListener(event === 'text' ? 'message' : event, (message) => {
        if (event === 'text') {
          if (typeof message.data === 'string')
            listener(Buffer.from(message.data, 'utf8'));
          return;
        }
        if (event !== 'message') return listener(Buffer.alloc(0));
        if (message.data instanceof ArrayBuffer) listener(Buffer.from(message.data));
      });
    },
  };
}
