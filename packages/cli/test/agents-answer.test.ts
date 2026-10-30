import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_STATUS,
  DAEMON_METHOD,
  MEMNOX_HOME,
  NodeSnapshotStore,
  PROPOSAL_KIND,
  proposalCapability,
  Proposals,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SessionPauses,
  SqliteEventStore,
  type DaemonRequest,
  type DaemonResponse,
  type MemnoxEvent,
  type SessionCard,
} from '@memnox/core';
import { agentsAnswer, isAgentsMethod } from '../src/daemon/agents-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/**
 * The agent manager's daemon methods: a card per agent found here, a pause done at once, a
 * resume only once the person signs it, and a session stopped before its next action.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const CARDS: SessionCard[] = [
  {
    sessionId: 's1',
    agent: 'claude-code',
    agentName: 'Claude',
    state: 'working',
    thinking: false,
  },
  {
    sessionId: 's2',
    agent: 'claude-code',
    agentName: 'Claude',
    state: 'ended',
    thinking: false,
  },
  {
    sessionId: 's3',
    agent: 'claude-code',
    agentName: 'Claude',
    state: 'idle',
    thinking: false,
  },
];

function event(id: string, effect: string): MemnoxEvent {
  return {
    id,
    schemaVersion: 1,
    // At the very moment asked, so it falls on today in every time zone.
    at: NOW.toISOString(),
    sessionId: 's1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'git.push',
    target: 'main',
    class: 'write',
    effect,
    mode: 'enforce',
    reason: 'a rule',
  } as MemnoxEvent;
}

async function fixture(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-agents-'));
  await new NodeSnapshotStore(join(home, MEMNOX_HOME)).save({
    takenAt: '2026-10-30T10:00:00.000Z',
    agents: [{ id: 'agt_claude-code', kind: 'claude-code', surfaces: [] }],
    servers: [],
    resources: [],
  });
  const store = SqliteEventStore.forHome(home);
  await store.append(event('e1', 'allow'));
  await store.append(event('e2', 'deny'));
  store.close();
  return home;
}

function ask(home: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  const full = { id: 1, method: DAEMON_METHOD.AGENTS, ...request } as DaemonRequest;
  return agentsAnswer(home, full, { now: NOW, cards: async () => CARDS });
}

describe('the agent manager methods', () => {
  it('are reads a phone may make, and holds it may ask for', () => {
    expect(isAgentsMethod('agents')).toBe(true);
    expect(isVoiceMethod('session-stop')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.AGENTS)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.AGENT_PAUSE)).toBe(REMOTE_CAPABILITY.ASK);
    expect(proposalCapability({ kind: PROPOSAL_KIND.AGENT_RESUME, agent: 'x' })).toBe(
      REMOTE_CAPABILITY.STEER,
    );
  });

  it('draws a card per agent with its sessions, today and its last actions', async () => {
    const home = await fixture();
    const answer = await ask(home, {});
    expect(answer.agentsView).toHaveLength(1);
    expect(answer.agentsView?.[0]).toMatchObject({
      kind: 'claude-code',
      status: AGENT_STATUS.UNPROTECTED,
      sessions: { running: 1, idle: 1, finished: 1 },
      today: { actions: 2, asked: 0, refused: 1 },
      mcpServers: [],
    });
    expect(answer.agentsView?.[0]?.recent.map((each) => each.id)).toEqual(['e2', 'e1']);
  });

  it('pauses at once, and resumes only through a signed proposal', async () => {
    const home = await fixture();
    const paused = await ask(home, {
      method: DAEMON_METHOD.AGENT_PAUSE,
      agentKind: 'claude-code',
    });
    expect(paused.agentsView?.[0]?.status).toBe(AGENT_STATUS.PAUSED);
    const resumed = await ask(home, {
      method: DAEMON_METHOD.AGENT_RESUME,
      agentKind: 'claude-code',
    });
    expect(resumed.proposed).toMatch(/^prp_/);
    expect(resumed.agentsView?.[0]?.status).toBe(AGENT_STATUS.PAUSED);
    const proposal = await new Proposals(home).read(resumed.proposed ?? '');
    expect(proposal?.change).toEqual({
      kind: PROPOSAL_KIND.AGENT_RESUME,
      agent: 'claude-code',
    });
  });

  it('stops a session before its next action', async () => {
    const home = await fixture();
    const answer = await ask(home, {
      method: DAEMON_METHOD.SESSION_STOP,
      sessionId: 's1',
    });
    expect(answer.ok).toBe(true);
    expect(await new SessionPauses(home).inForce('s1')).not.toBeNull();
  });

  it('answers no agents before any scan', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-agents-'));
    expect((await ask(home, {})).agentsView).toEqual([]);
  });
});
