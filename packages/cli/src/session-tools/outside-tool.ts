import { externalContacts, LEDGER_SESSION_LIMIT } from '@memnox/core';
import { withEvents } from '../event-store';
import { MOST_ROWS } from './bounded';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { scopeOf } from './session-scope';

/**
 * What a session reached outside this machine: hosts fetched, MCP servers called, pages
 * opened. Destinations only, since the ledger never keeps what came back.
 */
export async function outsideTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  return withEvents(deps.home, async (store) => {
    const scope = await scopeOf(store, deps, textArg(args, 'session'));
    if (scope.sessionId === null) return { ...scope, contacts: [] };
    const rows = await store.query({
      sessionId: scope.sessionId,
      limit: LEDGER_SESSION_LIMIT,
    });
    const contacts = externalContacts(rows);
    return {
      ...scope,
      total: contacts.length,
      contacts: contacts.slice(0, MOST_ROWS),
      ...(contacts.length === 0
        ? { said: 'Nothing outside this machine is recorded for this session.' }
        : {}),
    };
  });
}
