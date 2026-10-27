/**
 * JSON-RPC over lines, as the Agent Client Protocol speaks it on stdio. It holds no process,
 * so a test drives it with strings, and the brain owns the one it writes to.
 */

/** What JSON-RPC calls a method it does not have. */
const METHOD_NOT_FOUND = -32601;

interface AcpHandlers {
  /** A notification from the agent, such as a session update. */
  notify(method: string, params: unknown): void;
  /** A request from the agent; null answers that this client has no such method. */
  request(method: string, params: unknown): unknown;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class AcpConnection {
  private next = 0;
  private readonly pending = new Map<number, Pending>();
  private ended: Error | null = null;

  constructor(
    private readonly write: (line: string) => void,
    private readonly handlers: AcpHandlers,
  ) {}

  request(method: string, params: unknown): Promise<unknown> {
    if (this.ended !== null) return Promise.reject(this.ended);
    this.next += 1;
    const id = this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.ended === null) this.send({ jsonrpc: '2.0', method, params });
  }

  /** One line the agent wrote; anything that is not JSON-RPC is its own logging and is skipped. */
  receive(line: string): void {
    const message = parse(line);
    if (message === null) return;
    const id = message['id'];
    const method = message['method'];
    if (typeof method === 'string') {
      if (id === undefined) this.handlers.notify(method, message['params']);
      else this.answer(id, this.handlers.request(method, message['params']));
      return;
    }
    if (typeof id !== 'number') return;
    const waiting = this.pending.get(id);
    if (waiting === undefined) return;
    this.pending.delete(id);
    const error = message['error'];
    if (isRecord(error)) waiting.reject(asError(error));
    else waiting.resolve(message['result']);
  }

  /** The process is gone, so every question still waiting is answered with why. */
  end(reason: Error): void {
    this.ended = reason;
    for (const waiting of this.pending.values()) waiting.reject(reason);
    this.pending.clear();
  }

  private answer(id: unknown, result: unknown): void {
    if (result === null) {
      this.send({
        jsonrpc: '2.0',
        id,
        error: { code: METHOD_NOT_FOUND, message: 'Memnox offers no such method' },
      });
      return;
    }
    this.send({ jsonrpc: '2.0', id, result });
  }

  private send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    // Some agents log to stdout before the protocol starts; that is noise, never a fault.
    return null;
  }
}

/** The agent's code rides as the cause, because it says whether the agent wants a login. */
function asError(error: Record<string, unknown>): Error {
  const message =
    typeof error['message'] === 'string' ? error['message'] : 'the agent refused';
  const code = typeof error['code'] === 'number' ? error['code'] : 0;
  return new Error(message, { cause: code });
}

/** What ACP answers when the agent is not logged in. */
export const ACP_AUTH_REQUIRED = -32000;
