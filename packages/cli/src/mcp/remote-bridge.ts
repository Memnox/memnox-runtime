/**
 * The workspace's MCP server reached over stdio, for an agent whose config takes only a command
 * to start, such as Claude Desktop, which skips an entry that names a URL. Each line the agent
 * writes is posted to the workspace and every message that comes back is written as a line.
 */

import { REMOTE_BRIDGE_ENV } from '@memnox/core';
import { relayToCloud } from '../sync/client';

/** Where the credential travels, kept out of the command line so no process listing shows it. */
export const BRIDGE_AUTHORIZATION_ENV = REMOTE_BRIDGE_ENV;

const SESSION_HEADER = 'mcp-session-id';
const VERSION_HEADER = 'mcp-protocol-version';
const EVENT_STREAM = 'text/event-stream';
const INITIALIZE = 'initialize';

/** A JSON-RPC error code in the range left to servers, for a call the workspace never answered. */
const UNREACHABLE_CODE = -32000;

type Relay = (
  url: string,
  init: { method: 'POST' | 'DELETE'; headers: Record<string, string>; body?: string },
) => Promise<Response>;

interface BridgeOptions {
  url: string;
  authorization: string;
  write: (line: string) => void;
  relay?: Relay;
  /** Why something went wrong, for the agent's own log, never the protocol stream. */
  log?: (line: string) => void;
}

interface Bridge {
  /** One line the agent wrote, posted once the session it belongs to exists. */
  handle: (line: string) => Promise<void>;
  /** The workspace told the session is over, so it can let it go at once. */
  close: () => Promise<void>;
}

interface Message {
  id?: string | number | null;
  method?: string;
  result?: { protocolVersion?: unknown };
}

/** The bridge's own settings with the session it opened, which every post reads. */
interface Link {
  options: BridgeOptions;
  relay: Relay;
  opened: Opened;
}

/** What the workspace named once the session opened, carried on every message after. */
interface Opened {
  session?: string;
  version?: string;
}

export function createBridge(options: BridgeOptions): Bridge {
  const relay = options.relay ?? relayToCloud;
  const opened: Opened = {};
  // Every message after initialize waits for it, since only its answer names the session the rest belong to.
  let ready: Promise<void> = Promise.resolve();
  const post = (line: string, message: Message): Promise<void> =>
    posted({ options, relay, opened }, line, message);
  return {
    handle: async (line) => {
      const text = line.trim();
      const message = text === '' ? null : parsed(text);
      if (message === null) {
        if (text !== '')
          options.log?.('the agent wrote a line that is not JSON, so it was not sent');
        return;
      }
      if (message.method === INITIALIZE) {
        ready = post(text, message);
        return ready;
      }
      await ready;
      return post(text, message);
    },
    close: async () => {
      if (opened.session === undefined) return;
      await relay(options.url, {
        method: 'DELETE',
        headers: headersFor(options, opened),
      }).catch(() => undefined);
    },
  };
}

function headersFor(options: BridgeOptions, opened: Opened): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: `application/json, ${EVENT_STREAM}`,
    authorization: options.authorization,
    ...(opened.session === undefined ? {} : { [SESSION_HEADER]: opened.session }),
    ...(opened.version === undefined ? {} : { [VERSION_HEADER]: opened.version }),
  };
}

/** One message posted, and every message its answer carried written back, with the session and version kept. */
async function posted(link: Link, line: string, message: Message): Promise<void> {
  const { options, relay, opened } = link;
  let response: Response;
  try {
    response = await relay(options.url, {
      method: 'POST',
      headers: headersFor(options, opened),
      body: line,
    });
  } catch (error) {
    return failed(
      options,
      message,
      `the Memnox workspace could not be reached: ${String(error)}`,
    );
  }
  const named = response.headers.get(SESSION_HEADER);
  if (named !== null) opened.session = named;
  if (!response.ok)
    return failed(options, message, `the Memnox workspace answered ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  for (const each of type.includes(EVENT_STREAM)
    ? eventMessages(body)
    : jsonMessages(body)) {
    const offered = each.result?.protocolVersion;
    if (typeof offered === 'string') opened.version = offered;
    options.write(JSON.stringify(each));
  }
}

function failed(options: BridgeOptions, message: Message, why: string): void {
  options.log?.(why);
  // Only a request waits for an answer; a notification that could not go is only logged.
  if (message.id === undefined || message.method === undefined) return;
  options.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: UNREACHABLE_CODE, message: why },
    }),
  );
}

function parsed(text: string): Message | null {
  try {
    const value: unknown = JSON.parse(text);
    // A batch or a single message is relayed whole; only the fields read here are typed.
    return typeof value === 'object' && value !== null ? (value as Message) : null;
  } catch {
    return null;
  }
}

/** A JSON body, which holds one message or a batch of them, or nothing at all for an accepted notification. */
function jsonMessages(body: string): Message[] {
  const message = body.trim() === '' ? null : parsed(body);
  if (message === null) return [];
  return Array.isArray(message) ? (message as Message[]) : [message];
}

/** The messages an event stream carried, one per event, each event's data lines joined as the format says. */
export function eventMessages(body: string): Message[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).replace(/^ /, ''))
        .join('\n'),
    )
    .filter((data) => data !== '')
    .flatMap((data) => jsonMessages(data));
}
