import {
  ACTIVITY_PAGE_ROWS,
  activityRowOf,
  AGENT_ID_PREFIX,
  buildBundle,
  cursorOf,
  isPastCursor,
  LEDGER_LOOKUP_LIMIT,
  matchesActivity,
  MOST_ACTIVITY_ROWS,
  readCursor,
  generateKeys,
  type ActivityFilter,
  type ActivityPage,
  type EventQuery,
  type MemnoxEvent,
  type SqliteEventStore,
} from '@memnox/core';
import { displayName, readNames, type AgentNames } from '../agents/names';
import { withEvents } from '../event-store';

/**
 * The ledger paged for a screen, newest first: the ledger's own query narrows by agent, effect
 * and time, the rest is matched here, and the rows read are bounded however little matches.
 */

/** Rows read from the ledger at a time while a page fills. */
const BATCH_ROWS = 500;

/** The most rows one page may read before it answers with what it found, so no filter scans for ever. */
const MOST_ROWS_SCANNED = 5_000;

interface ActivityAsk {
  filter: ActivityFilter;
  cursor?: string;
  limit?: number;
}

export async function readActivityPage(
  home: string,
  ask: ActivityAsk,
): Promise<ActivityPage> {
  const limit = Math.min(
    Math.max(ask.limit ?? ACTIVITY_PAGE_ROWS, 1),
    MOST_ACTIVITY_ROWS,
  );
  const names = await readNames(home);
  const cursor = ask.cursor === undefined ? null : readCursor(ask.cursor);
  const found = await withEvents(home, (store) =>
    pageOf(store, { filter: ask.filter, cursor, limit }),
  );
  const rows = found.events.map((event) =>
    activityRowOf(event, nameOf(names, event.agent)),
  );
  return {
    rows,
    ...(found.next === undefined ? {} : { nextCursor: cursorOf(found.next) }),
  };
}

/** The agent as the person named it, or as its product is called. */
export function nameOf(names: AgentNames, agent: string): string {
  return displayName(names, { id: `${AGENT_ID_PREFIX}${agent}`, kind: agent });
}

interface Paging {
  filter: ActivityFilter;
  cursor: { at: string; id: string } | null;
  limit: number;
}

type Mark = { at: string; id: string };

/** Newest first, a batch at a time, until the page is full or the bound is reached. */
async function pageOf(
  store: SqliteEventStore,
  { filter, cursor, limit }: Paging,
): Promise<{ events: MemnoxEvent[]; next?: Mark }> {
  const kept: MemnoxEvent[] = [];
  let edge = cursor;
  for (let scanned = 0; scanned < MOST_ROWS_SCANNED; scanned += BATCH_ROWS) {
    const bound = edge;
    const batch = (await store.query(queryOf(filter, bound))).reverse();
    const fresh =
      bound === null ? batch : batch.filter((event) => isPastCursor(event, bound));
    for (const event of fresh) {
      if (!matchesActivity(event, filter)) continue;
      const last = kept[kept.length - 1];
      if (kept.length === limit && last !== undefined)
        return { events: kept, next: last };
      kept.push(event);
    }
    const oldest = fresh[fresh.length - 1];
    if (oldest === undefined || batch.length < BATCH_ROWS) return { events: kept };
    edge = { at: oldest.at, id: oldest.id };
  }
  // Bounded: what was read is answered, and the cursor lets the screen read on from there.
  return edge === null ? { events: kept } : { events: kept, next: edge };
}

function queryOf(filter: ActivityFilter, edge: { at: string } | null): EventQuery {
  const until = edge === null ? filter.until : edge.at;
  return {
    ...(filter.agent === undefined ? {} : { agent: filter.agent }),
    ...(filter.effect === undefined ? {} : { effects: [filter.effect] }),
    ...(filter.since === undefined ? {} : { since: filter.since }),
    ...(until === undefined ? {} : { until }),
    limit: BATCH_ROWS,
  };
}

/** The rows a filter selects as a signed bundle, in the shape `memnox verify` checks. */
export async function exportActivity(
  home: string,
  filter: ActivityFilter,
  now: Date,
): Promise<string> {
  const events = await withEvents(home, (store) =>
    store.query({ ...queryOf(filter, null), limit: LEDGER_LOOKUP_LIMIT }),
  );
  const kept = events.filter((event) => matchesActivity(event, filter));
  const { header, body } = buildBundle({
    events: kept,
    range: {
      from: filter.since ?? kept[0]?.at ?? now.toISOString(),
      to: filter.until ?? kept[kept.length - 1]?.at ?? now.toISOString(),
    },
    createdAt: now.toISOString(),
    excluded: excludedBy(filter, events.length),
    keys: generateKeys(),
  });
  return `${JSON.stringify(header, null, 2)}\n\n${body}\n`;
}

/** What the filter kept out, said in the bundle itself, since a silent omission would be relied on. */
function excludedBy(filter: ActivityFilter, read: number): string[] {
  return [
    ...(read === LEDGER_LOOKUP_LIMIT
      ? [
          `stopped at ${LEDGER_LOOKUP_LIMIT} events; older events exist and are not included`,
        ]
      : []),
    ...(filter.effect === undefined
      ? []
      : [`only ${filter.effect} events were asked for`]),
    ...(filter.agent === undefined ? [] : [`only ${filter.agent} was asked for`]),
    ...(filter.kind === undefined ? [] : [`only ${filter.kind} actions were asked for`]),
    ...(filter.text === undefined
      ? []
      : [`only events naming "${filter.text}" were asked for`]),
  ];
}
