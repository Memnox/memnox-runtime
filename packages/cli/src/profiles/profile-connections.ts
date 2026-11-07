import { join } from 'node:path';
import {
  AGENT_STATUS,
  connectionsFor,
  isDefaultProfileId,
  MEMNOX_HOME,
  NodeSnapshotStore,
  profileLevelsOf,
  type AgentConnection,
  type AgentView,
  type ConnectionEvidence,
  type EnvironmentSnapshot,
  type ProfileView,
  type SessionCard,
} from '@memnox/core';
import { readBindings } from '../agents/connections';
import { displayName, readNames, resolveAgent } from '../agents/names';
import { readAgentsView } from '../studio/agents-read';
import { withLevels, type SeamDigestRead } from './connection-levels';
import { readProfileViews } from './profile-apply';
import { responsiblePersonHere } from './responsible-person';

/**
 * Every agent this machine found, as the connection a profile reaches it through, and the default
 * profile each unbound agent answers to. Read off the last scan and the hooks, so nothing is written.
 */

/** What reading the connections is handed: the clock, and the sessions a live agent is told by. */
export interface ConnectionDeps {
  now: Date;
  cards: () => Promise<SessionCard[]>;
  /** The agent cards already read, so a caller that has them does not read them twice. */
  views?: AgentView[];
  /** The installed enforcement path's digest, where a caller has a cheaper read of it than a scan. */
  seamDigest?: SeamDigestRead;
}

/** Each connection, and the agents they were read from, so a bind resolves what a person typed. */
interface MachineConnections {
  connections: AgentConnection[];
  agents: { id: string; kind: string; name: string; view?: AgentView }[];
  takenAt?: string;
}

/** Held is a seam in place now, or a pause, which only a seam in place can keep. */
const HELD_STATUSES: readonly string[] = [AGENT_STATUS.PROTECTED, AGENT_STATUS.PAUSED];

export async function readConnections(
  home: string,
  deps: ConnectionDeps,
): Promise<MachineConnections> {
  const [snapshot, bindings, names] = await Promise.all([
    latestSnapshot(home),
    readBindings(home),
    readNames(home),
  ]);
  const levelled = (
    found: Parameters<typeof connectionsFor>[0],
    views: ReadonlyMap<string, AgentView>,
  ): Promise<AgentConnection[]> =>
    withLevels(home, connectionsFor(found, bindings), views, deps.seamDigest);
  if (snapshot === null)
    return { connections: await levelled([], new Map()), agents: [] };
  const views = deps.views ?? (await readAgentsView(home, deps));
  const agents = snapshot.agents.map((agent, index) => {
    const view = views[index];
    return {
      id: agent.id,
      kind: agent.kind,
      name: displayName(names, agent),
      ...(view !== undefined && view.kind === agent.kind ? { view } : {}),
    };
  });
  const evidence = agents.map((agent) => evidenceOf(agent, snapshot.takenAt));
  const byId = new Map(
    agents.flatMap((agent) => (agent.view === undefined ? [] : [[agent.id, agent.view]])),
  );
  return {
    connections: await levelled(evidence, byId),
    agents,
    takenAt: snapshot.takenAt,
  };
}

async function latestSnapshot(home: string): Promise<EnvironmentSnapshot | null> {
  // No scan yet is a machine where nothing was found, which is no agents rather than a fault.
  return new NodeSnapshotStore(join(home, MEMNOX_HOME)).latest().catch(() => null);
}

function evidenceOf(
  agent: MachineConnections['agents'][number],
  takenAt: string,
): ConnectionEvidence {
  const view = agent.view;
  return {
    agentId: agent.id,
    agentKind: agent.kind,
    ...(view === undefined || view.seam === undefined ? {} : { seam: view.seam }),
    held: view !== undefined && HELD_STATUSES.includes(view.status),
    running: view === undefined ? 0 : view.sessions.running,
    firstSeen: takenAt,
    lastSeen: takenAt,
  };
}

/** The agent a person typed, by its name, id or product, among those found or once bound. */
export function agentTyped(
  machine: MachineConnections,
  typed: string,
): { id: string; kind: string } | null {
  const known = [
    ...machine.agents,
    ...machine.connections
      .filter((each) => !machine.agents.some((agent) => agent.id === each.agentId))
      .flatMap((each) =>
        each.agentId === undefined || each.agentKind === undefined
          ? []
          : [{ id: each.agentId, kind: each.agentKind }],
      ),
  ];
  return resolveAgent(known, {}, typed) ?? resolveByName(machine, typed);
}

function resolveByName(
  machine: MachineConnections,
  typed: string,
): { id: string; kind: string } | null {
  const wanted = typed.trim().toLowerCase();
  return machine.agents.find((agent) => agent.name.toLowerCase() === wanted) ?? null;
}

/** The profile an unbound agent answers to, drawn from what it already has and never stored. */
function defaultProfileViews(
  machine: MachineConnections,
  responsiblePerson: string,
): ProfileView[] {
  return machine.connections
    .filter((each) => isDefaultProfileId(each.profileId))
    .flatMap((connection) => {
      const agent = machine.agents.find((each) => each.id === connection.agentId);
      if (agent === undefined) return [];
      return [
        {
          id: connection.profileId,
          name: agent.name,
          responsibilities: [],
          responsiblePerson,
          projects: [],
          skills: agent.view === undefined ? [] : agent.view.skills,
          mcpServers: agent.view === undefined ? [] : agent.view.mcpServers,
          updatedAt: machine.takenAt ?? connection.lastSeen,
          missing: [],
          isDefault: true,
          connections: [connection],
          levels: profileLevelsOf([connection]),
        },
      ];
    });
}

/** Every profile kept here with the connections it works through, then each unbound agent's default. */
export async function readProfilesWithConnections(
  home: string,
  deps: ConnectionDeps,
): Promise<ProfileView[]> {
  const [machine, kept, person] = await Promise.all([
    readConnections(home, deps),
    readProfileViews(home),
    responsiblePersonHere(home),
  ]);
  return [
    ...kept.map((view) => {
      const connections = machine.connections.filter(
        (each) => each.profileId === view.id,
      );
      return {
        ...view,
        responsiblePerson: view.responsiblePerson ?? person,
        connections,
        levels: profileLevelsOf(connections),
      };
    }),
    ...defaultProfileViews(machine, person),
  ];
}

/** The agent cards with the profile each works under and how sure Memnox is of what it does. */
export async function withProfiles(
  home: string,
  views: AgentView[],
  deps: ConnectionDeps,
): Promise<AgentView[]> {
  const { connections } = await readConnections(home, { ...deps, views });
  return views.map((view) => {
    const connection = connections.find((each) => each.agentKind === view.kind);
    if (connection === undefined) return view;
    return {
      ...view,
      profileId: connection.profileId,
      ...(connection.levels === undefined ? {} : { levels: connection.levels }),
    };
  });
}
