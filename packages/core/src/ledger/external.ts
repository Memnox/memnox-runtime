/**
 * What a session reached outside this machine, from the ledger alone: the hosts it fetched
 * from, the MCP servers and tools it called, and the pages a browser opened. The ledger keeps
 * destinations and never payloads, so this names where it went and never what came back.
 */
import { ACTION } from '../constants/action.constants';
import { DECISION_EFFECT } from '../constants/decision.constants';
import { EVENT_SURFACE, type MemnoxEvent } from '../event/event';

export const EXTERNAL_KIND = {
  WEB: 'web',
  MCP: 'mcp',
  BROWSER: 'browser',
} as const;

export type ExternalKind = (typeof EXTERNAL_KIND)[keyof typeof EXTERNAL_KIND];

/** One destination, with how often and how lately the session went there. */
export interface ExternalContact {
  kind: ExternalKind;
  /** A host for the web and the browser, a server for MCP. */
  name: string;
  count: number;
  firstAt: string;
  lastAt: string;
  /** The MCP tools called on this server, or the kinds of request made to this host. */
  operations: string[];
  /** How many of those the rules refused or held, so "it tried" is not told as "it did". */
  refused: number;
}

/** What a web search is filed under, since a search names no host. */
export const WEB_SEARCH_NAME = 'web search';

/** The prefix a hook gives an MCP call's action, which the proxy's own rows do not carry. */
const MCP_ACTION_PREFIX = 'mcp.';

const NOT_DONE: readonly string[] = [DECISION_EFFECT.DENY, DECISION_EFFECT.ASK];

/** Newest first, so the answer starts with what the session is reaching right now. */
export function externalContacts(events: readonly MemnoxEvent[]): ExternalContact[] {
  const found = new Map<string, ExternalContact>();
  for (const event of events) {
    const place = placeOf(event);
    if (place === null) continue;
    const key = `${place.kind}\u0000${place.name}`;
    const contact = found.get(key) ?? {
      kind: place.kind,
      name: place.name,
      count: 0,
      firstAt: event.at,
      lastAt: event.at,
      operations: [],
      refused: 0,
    };
    contact.count += 1;
    if (event.at < contact.firstAt) contact.firstAt = event.at;
    if (event.at > contact.lastAt) contact.lastAt = event.at;
    if (!contact.operations.includes(place.operation))
      contact.operations.push(place.operation);
    if (NOT_DONE.includes(event.effect)) contact.refused += 1;
    found.set(key, contact);
  }
  return [...found.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

interface Place {
  kind: ExternalKind;
  name: string;
  operation: string;
}

function placeOf(event: MemnoxEvent): Place | null {
  if (event.operation === ACTION.BROWSER_NAVIGATE) {
    return {
      kind: EXTERNAL_KIND.BROWSER,
      name: event.target ?? 'a page',
      operation: 'open',
    };
  }
  if (event.surface === EVENT_SURFACE.NETWORK) {
    return {
      kind: EXTERNAL_KIND.WEB,
      name: event.target ?? WEB_SEARCH_NAME,
      operation: event.operation,
    };
  }
  if (event.surface === EVENT_SURFACE.MCP) return mcpPlace(event);
  return null;
}

/** "mcp.github.list_issues" from a hook and "github.list_issues" from the proxy name one call. */
function mcpPlace(event: MemnoxEvent): Place {
  const bare = event.operation.startsWith(MCP_ACTION_PREFIX)
    ? event.operation.slice(MCP_ACTION_PREFIX.length)
    : event.operation;
  const dot = bare.indexOf('.');
  const server = event.target ?? (dot === -1 ? bare : bare.slice(0, dot));
  const tool = dot === -1 ? bare : bare.slice(dot + 1);
  return { kind: EXTERNAL_KIND.MCP, name: server, operation: tool };
}
