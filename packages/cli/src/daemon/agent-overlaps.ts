import {
  Clashes,
  concurrentWork,
  DEFAULT_COLLISION_WINDOW_MINUTES,
  HOUR_MS,
  LeaseRegistry,
  LEDGER_SCAN_LIMIT,
  minutesToMs,
  workObservationsOf,
  type AgentOverlapsView,
} from '@memnox/core';
import { withEvents } from '../event-store';

/** As far back as a held write is still worth saying on a card: the working day it happened in. */
const HELD_BACK_MS = 12 * HOUR_MS;
/** As many of each as a card has room for, newest first. */
const MOST_SHOWN = 20;

/**
 * Where agents meet on this machine: the holds in force, the files two agents are in inside
 * the collision window, and the writes held lately. Names and paths only, never contents.
 */
export async function readAgentOverlaps(
  home: string,
  now: Date,
): Promise<AgentOverlapsView> {
  const at = now.toISOString();
  const since = new Date(
    now.getTime() - minutesToMs(DEFAULT_COLLISION_WINDOW_MINUTES),
  ).toISOString();
  const [leases, events, clashes] = await Promise.all([
    new LeaseRegistry(home).held(at).catch(() => []),
    withEvents(home, (store) => store.query({ since, limit: LEDGER_SCAN_LIMIT })),
    new Clashes(home)
      .since(new Date(now.getTime() - HELD_BACK_MS).toISOString(), at)
      .catch(() => []),
  ]);
  const together = togetherOf(events, at);
  return {
    holds: leases.slice(-MOST_SHOWN).map((lease) => ({
      agent: lease.holder.agent,
      path: lease.path,
      ...(lease.repository === undefined ? {} : { repository: lease.repository }),
      until: lease.expiresAt,
    })),
    // Two sessions of one agent in a file is that agent's own business, not a collision between agents.
    together: together.filter((each) => each.agents.length > 1).slice(0, MOST_SHOWN),
    heldBack: clashes
      .slice(-MOST_SHOWN)
      .reverse()
      .map(({ agent, what, said, at: when }) => ({ agent, what, said, at: when })),
  };
}

/** Each file several agents touched inside the window, with who and when last. */
function togetherOf(events: Parameters<typeof workObservationsOf>[0], at: string) {
  return concurrentWork(workObservationsOf(events), { now: at }).map((collision) => ({
    target: collision.target,
    agents: [...new Set(collision.agents.map((agent) => agent.agentName))],
    at: collision.agents.at(-1)?.at ?? at,
  }));
}
