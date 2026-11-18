import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SIGN_IN_PAGE, signInPage, type SignInPage } from './callback-page';

/**
 * Where a sign in comes back to: one page on this machine, open for one answer and closed after.
 * Bound to the loopback address only, so nothing off this machine can reach it. The browser is held
 * a moment for the real outcome, so the tab says what happened rather than a guess.
 */

/** What the sign in page sent back: the code to exchange, or why there is none. */
export interface CallbackAnswer {
  code?: string;
  state?: string;
  error?: string;
}

export interface CallbackListener {
  redirectUri: string;
  answer(): Promise<CallbackAnswer>;
  /** What the browser that brought the answer is shown. Until this is said, it waits, for a bounded moment. */
  reply(page: SignInPage): void;
  close(): Promise<void>;
}

export interface ListenOptions {
  /** The server being signed in to, which every page names. */
  server: string;
  /** A port to listen on, where a client was registered with one; absent is any free one. */
  port?: number;
}

/** Opens the listener; injected so a test binds no port. */
export type ListenForCallback = (options: ListenOptions) => Promise<CallbackListener>;

const LOOPBACK = '127.0.0.1';
const CALLBACK_PATH = '/callback';
/** Asks the system for any free port. */
const ANY_PORT = 0;
const NOT_FOUND = 404;
/** How long the tab waits on the outcome before it is told the terminal will show it. */
const PAGE_WAIT_MS = 8_000;
/** A browser keeps a connection open for reuse, which would otherwise hold the close for as long. */
const KEEP_ALIVE_MS = 1_000;

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  connection: 'close',
};

export function listenOnLoopback({
  server: name,
  port,
}: ListenOptions): Promise<CallbackListener> {
  const page = new CallbackPage(name);
  const server = createServer((request, response) => page.serve(request.url, response));
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port ?? ANY_PORT, LOOPBACK, () => {
      // Cast is safe: a server listening on a TCP port answers with its address and port.
      const { port: bound } = server.address() as AddressInfo;
      resolve({
        redirectUri: `http://${LOOPBACK}:${bound}${CALLBACK_PATH}`,
        answer: () => page.answered,
        reply: (shown) => page.reply(shown),
        close: () => {
          page.end();
          // Connections a browser keeps open, or opened ahead of a request, would hold the close indefinitely.
          server.closeAllConnections();
          return new Promise((closed) => server.close(() => closed()));
        },
      });
    });
  });
}

/** The one answer the page takes, and the browser that brought it, held until it can be told the outcome. */
class CallbackPage {
  readonly answered: Promise<CallbackAnswer>;
  private settle: (answer: CallbackAnswer) => void = () => undefined;
  private held: ServerResponse | null = null;
  private shown: SignInPage | null = null;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  private readonly finishing: SignInPage;

  constructor(server: string) {
    this.finishing = { kind: SIGN_IN_PAGE.FINISHING, server };
    this.answered = new Promise((done) => {
      this.settle = done;
    });
  }

  serve(url: string | undefined, response: ServerResponse): void {
    const asked = new URL(url ?? '/', `http://${LOOPBACK}`);
    if (asked.pathname !== CALLBACK_PATH) {
      response.writeHead(NOT_FOUND, { connection: 'close' }).end();
      return;
    }
    // A refresh after the answer shows what was shown, and never starts a second exchange.
    if (this.held !== null || this.shown !== null) {
      response.writeHead(200, PAGE_HEADERS).end(signInPage(this.shown ?? this.finishing));
      return;
    }
    this.held = response;
    this.fallback = setTimeout(() => this.send(this.finishing), PAGE_WAIT_MS);
    this.fallback.unref();
    this.settle(answerOf(asked.searchParams));
  }

  reply(page: SignInPage): void {
    this.shown = page;
    this.send(page);
  }

  /** A browser still held is told what is known, so no tab is left loading. */
  end(): void {
    this.send(this.shown ?? this.finishing);
  }

  private send(page: SignInPage): void {
    if (this.fallback !== null) clearTimeout(this.fallback);
    this.fallback = null;
    const response = this.held;
    this.held = null;
    response?.writeHead(200, PAGE_HEADERS).end(signInPage(page));
  }
}

function answerOf(params: URLSearchParams): CallbackAnswer {
  const answer: CallbackAnswer = {};
  for (const name of ['code', 'state', 'error'] as const) {
    const value = params.get(name);
    if (value !== null) answer[name] = value;
  }
  return answer;
}
