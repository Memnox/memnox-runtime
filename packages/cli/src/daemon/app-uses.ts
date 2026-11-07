import {
  daysToMs,
  EVENT_SURFACE,
  type AppUse,
  type MemnoxEvent,
  type ToolConnection,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { APP_ACTION_PREFIX } from '../session-tools/app-calls';

/**
 * Which agents worked in each connected app through Memnox lately, read from this machine's ledger,
 * where every such call is a row by name. Only agent and session are said, never what was done.
 */

/** Long enough to cover a week of work, short enough that an agent from last month is not named as using it. */
const USED_WITHIN_MS = daysToMs(7);
/** Enough rows to find every agent of a busy week without reading the whole ledger. */
const MOST_ROWS_READ = 2_000;
/** A card names a few agents, newest first. */
const MOST_AGENTS_NAMED = 5;

export async function appUsesSince(
  home: string,
  now: Date,
): Promise<Map<string, AppUse[]>> {
  const since = new Date(now.getTime() - USED_WITHIN_MS).toISOString();
  const rows = await withEvents(home, (store) =>
    store.query({ surface: EVENT_SURFACE.MCP, since, limit: MOST_ROWS_READ }),
  );
  return usesOf(rows);
}

/** Each app's agents, newest call first, one entry per agent. */
export function usesOf(rows: readonly MemnoxEvent[]): Map<string, AppUse[]> {
  const prefix = `${APP_ACTION_PREFIX}.`;
  const uses = new Map<string, AppUse[]>();
  for (const row of [...rows].sort((a, b) => b.at.localeCompare(a.at))) {
    if (!row.operation.startsWith(prefix) || row.target === undefined) continue;
    const named = uses.get(row.target) ?? [];
    if (
      named.length >= MOST_AGENTS_NAMED ||
      named.some((each) => each.agent === row.agent)
    )
      continue;
    named.push({ agent: row.agent, sessionId: row.sessionId, at: row.at });
    uses.set(row.target, named);
  }
  return uses;
}

/** The list with each app's recent agents beside it, unchanged where none used it. */
export function withUses(
  connections: readonly ToolConnection[],
  uses: ReadonlyMap<string, AppUse[]>,
): ToolConnection[] {
  return connections.map((each) => {
    const used = uses.get(each.toolkit.toLowerCase());
    return used === undefined || used.length === 0 ? each : { ...each, usedBy: used };
  });
}
