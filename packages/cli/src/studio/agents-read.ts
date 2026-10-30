import { join } from 'node:path';
import {
  AGENT_STATUS,
  agentFrozen,
  agentPatterns,
  agentsOf,
  DECISION_EFFECT,
  inForce,
  LEDGER_RECENT_LIMIT,
  LEDGER_SCAN_LIMIT,
  MEMNOX_HOME,
  NodeSnapshotStore,
  OVERLAY_KIND,
  overlaysInForce,
  readHub,
  readOrgServers,
  startableKindOf,
  withOrganization,
  type AgentSessions,
  type AgentStatus,
  type AgentView,
  type MemnoxEvent,
  type Overlay,
  type SessionCard,
  type SnapshotAgent,
} from '@memnox/core';
import { displayName, readNames, type AgentNames } from '../agents/names';
import { withEvents } from '../event-store';
import { readDormantHere } from '../keeper/keep-dormant';
import { readKept } from '../keeper/kept';
import { readHubConfigs } from '../mcp/hub-writer';
import { EDIT_HOOK_TARGETS } from '../protect/agent-hooks';
import { SESSION_STATE } from '../session-tools/sessions-tool';

/**
 * The agents on this machine, one card each, from the kept scan, the keeper's record of hooks,
 * the hub, the sessions and the ledger. Names only: an action is its operation and its target.
 */

const RECENT_SHOWN = 5;
const RUNNING: readonly string[] = [SESSION_STATE.WORKING, SESSION_STATE.OPEN];
const FINISHED: readonly string[] = [SESSION_STATE.ENDED];

/** What every card is drawn from, read once for all of them. */
interface Facts {
  names: AgentNames;
  hooked: readonly string[];
  dormant: ReadonlySet<string>;
  freezes: readonly Overlay[];
  hub: Awaited<ReturnType<typeof readHub>>;
  configs: Awaited<ReturnType<typeof readHubConfigs>>;
  cards: readonly SessionCard[];
  today: readonly MemnoxEvent[];
  recent: readonly MemnoxEvent[];
  at: string;
}

export async function readAgentsView(
  home: string,
  { now, cards }: { now: Date; cards: () => Promise<SessionCard[]> },
): Promise<AgentView[]> {
  const snapshots = new NodeSnapshotStore(join(home, MEMNOX_HOME));
  // No scan yet is a machine where nothing was found, which is no agents rather than a fault.
  const snapshot = await snapshots.latest().catch(() => null);
  if (snapshot === null) return [];
  const facts = await factsOf(home, { now, cards, snapshots });
  return snapshot.agents.map((agent) => agentView(agent, facts));
}

async function factsOf(
  home: string,
  input: { now: Date; cards: () => Promise<SessionCard[]>; snapshots: NodeSnapshotStore },
): Promise<Facts> {
  const at = input.now.toISOString();
  const [names, kept, dormant, overlays, hub, configs, cards, ledger] = await Promise.all(
    [
      readNames(home),
      readKept(home),
      // A keeper record that will not read claims no agent is dormant, which is the honest answer.
      readDormantHere(home, input.snapshots, input.now).catch(() => []),
      overlaysInForce(home),
      readHub(home).then(async (hub) =>
        withOrganization(hub, await readOrgServers(home)),
      ),
      readHubConfigs(home, home),
      // Sessions that will not list leave every count at none rather than failing the cards.
      input.cards().catch((): SessionCard[] => []),
      ledgerOf(home, input.now),
    ],
  );
  return {
    names,
    hooked:
      kept === null ? [] : kept.hooked.filter((each) => !kept.declined.includes(each)),
    dormant: new Set(dormant.map((each) => each.kind)),
    freezes: inForce(overlays, at).filter((each) => each.kind === OVERLAY_KIND.FREEZE),
    hub,
    configs,
    cards,
    ...ledger,
    at,
  };
}

async function ledgerOf(
  home: string,
  now: Date,
): Promise<Pick<Facts, 'today' | 'recent'>> {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return withEvents(home, async (store) => ({
    today: await store.query({ since: midnight.toISOString(), limit: LEDGER_SCAN_LIMIT }),
    recent: await store.query({ limit: LEDGER_RECENT_LIMIT }),
  }));
}

function agentView(agent: SnapshotAgent, facts: Facts): AgentView {
  const names = agentPatterns(agent.kind);
  const mine = (name: string): boolean => names.includes(name);
  const freeze = facts.freezes.find((each) =>
    agentFrozen([`${each.kind}:${each.subject}`], agent.kind),
  );
  const config = facts.configs.find((each) => each.agent === agent.kind);
  const today = facts.today.filter((event) => mine(event.agent));
  return {
    kind: agent.kind,
    name: displayName(facts.names, agent),
    status: statusOf(agent.kind, freeze !== undefined, facts),
    ...(agent.host === undefined ? {} : { installed: agent.host.location }),
    ...(config === undefined ? {} : { configPath: config.path }),
    ...(freeze === undefined ? {} : { pausedUntil: freeze.validUntil }),
    sessions: sessionsOf(facts.cards.filter((card) => mine(card.agent))),
    mcpServers: facts.hub.servers
      .filter((server) => agentsOf(facts.hub, server.name).some((each) => mine(each)))
      .map((server) => server.name),
    today: {
      actions: today.length,
      asked: today.filter((event) => saidOf(event) === DECISION_EFFECT.ASK).length,
      refused: today.filter((event) => saidOf(event) === DECISION_EFFECT.DENY).length,
    },
    recent: recentOf(facts.recent.filter((event) => mine(event.agent))),
    launchable: startableKindOf(agent.kind) !== null,
  };
}

/** Counted by what enforce would have said, so observe mode shows what it would have stopped. */
function saidOf(event: MemnoxEvent): string {
  return event.shadowEffect ?? event.effect;
}

/** A pause wins, then a month of silence; otherwise whether its hook is in. */
function statusOf(kind: string, paused: boolean, facts: Facts): AgentStatus {
  if (paused) return AGENT_STATUS.PAUSED;
  if (facts.dormant.has(kind)) return AGENT_STATUS.DORMANT;
  const hooked = EDIT_HOOK_TARGETS.some(
    (target) => target.agent === kind && facts.hooked.includes(target.name),
  );
  return hooked ? AGENT_STATUS.PROTECTED : AGENT_STATUS.UNPROTECTED;
}

function sessionsOf(cards: readonly SessionCard[]): AgentSessions {
  const running = cards.filter((card) => RUNNING.includes(card.state) || card.thinking);
  const finished = cards.filter((card) => FINISHED.includes(card.state));
  return {
    running: running.length,
    finished: finished.length,
    idle: cards.length - running.length - finished.length,
  };
}

function recentOf(events: readonly MemnoxEvent[]): AgentView['recent'] {
  return events
    .slice(-RECENT_SHOWN)
    .reverse()
    .map((event) => ({
      id: event.id,
      at: event.at,
      operation: event.operation,
      ...(event.target === undefined ? {} : { target: event.target }),
      effect: event.effect,
    }));
}
