import type { DiscoveredAgent } from './agent';
import type { EnvironmentSnapshot } from './snapshot';

/**
 * When an agent arrived and whether it is still here, read off the kept scans rather than
 * a file's mtime, so an agent removed last week is a row and never a silent absence. A
 * governed agent that was uninstalled is the one a roster would otherwise go on counting.
 */
export interface AgentArrival {
  id: string;
  /**
   * The oldest kept scan that holds it. Absent when the oldest scan holds it too, since
   * "at least this long" is the honest answer there and a date would not be.
   */
  since?: string;
}

export interface AgentDeparture {
  id: string;
  kind: string;
  /** The last kept scan that still held it. */
  lastSeen: string;
}

export interface AgentLifecycle {
  present: AgentArrival[];
  /** In an earlier scan and not on this machine now. */
  gone: AgentDeparture[];
}

/** History is oldest first, the order the snapshot store returns it in. */
export function agentLifecycle(
  current: readonly Pick<DiscoveredAgent, 'id'>[],
  history: readonly EnvironmentSnapshot[],
): AgentLifecycle {
  const here = new Set(current.map((agent) => agent.id));
  const oldest = history[0];
  const present = current.map((agent): AgentArrival => {
    const held = (snapshot: EnvironmentSnapshot): boolean =>
      snapshot.agents.some((each) => each.id === agent.id);
    const arrival = history.find(held);
    if (arrival === undefined || (oldest !== undefined && held(oldest))) {
      return { id: agent.id };
    }
    return { id: agent.id, since: arrival.takenAt };
  });

  const gone = new Map<string, AgentDeparture>();
  for (const snapshot of history) {
    for (const agent of snapshot.agents) {
      if (here.has(agent.id)) continue;
      gone.set(agent.id, { id: agent.id, kind: agent.kind, lastSeen: snapshot.takenAt });
    }
  }
  return { present, gone: [...gone.values()] };
}
