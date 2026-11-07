import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SqliteEventStore,
  toolListKey,
  type DaemonRequest,
  type DiscoveryReport,
  type MemnoxEvent,
  type ToolLists,
} from '@memnox/core';
import { agentsAnswer, isAgentsMethod } from '../src/daemon/agents-answer';
import { countedBehind } from '../src/session-tools/agents-tool';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

/**
 * AGENTS_SCAN, the scan a screen draws without the voice: the counted facts the voice's scan puts up, read and
 * never shown, with working only for a session working now and the real capabilities counting rather than zero.
 */

const NOW = new Date('2026-10-23T09:00:00.000Z');
const MINUTE_MS = 60 * 1_000;

const GITHUB = { name: 'github', command: '/opt/homebrew/bin/npx', args: ['github-mcp'] };

const quick = {
  agents: [{ id: 'agt_claude-code', kind: 'claude-code' }],
  surfaces: [{ agentId: 'agt_claude-code', kind: 'mcp', servers: [GITHUB] }],
  authenticated: [],
} as unknown as DiscoveryReport;

const full = {
  ...quick,
  surfaces: [
    {
      agentId: 'agt_claude-code',
      kind: 'mcp',
      servers: [GITHUB],
      tools: [
        { server: 'github', name: 'merge_pull_request', effect: 'write' },
        { server: 'github', name: 'list_issues', effect: 'read' },
      ],
    },
  ],
} as unknown as DiscoveryReport;

function event(id: string, sessionId: string, at: Date): MemnoxEvent {
  return {
    id,
    schemaVersion: 1,
    at: at.toISOString(),
    sessionId,
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'git.status',
    target: '.',
    class: 'read',
    effect: 'allow',
    mode: 'enforce',
    reason: 'a rule',
  } as MemnoxEvent;
}

async function homeWithSessions(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-agents-scan-'));
  const store = SqliteEventStore.forHome(home);
  // One session acting now, and one quiet for half an hour, which is not working.
  await store.append(event('e1', 's-now', NOW));
  await store.append(event('e2', 's-quiet', new Date(NOW.getTime() - 30 * MINUTE_MS)));
  store.close();
  return home;
}

function depsFor(home: string): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

function scanRequest(): DaemonRequest {
  return { id: 7, method: DAEMON_METHOD.AGENTS_SCAN } as DaemonRequest;
}

describe('the agents scan a screen asks for', () => {
  it('is a method only the Mac may ask, since it can start servers to count them', () => {
    expect(isAgentsMethod('agents-scan')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.AGENTS_SCAN)).toBe(REMOTE_CAPABILITY.MAC);
  });

  it('answers each agent counted, working only for a session working now, without the cards', async () => {
    const home = await homeWithSessions();
    let lists: ToolLists = { [toolListKey(GITHUB.command, GITHUB.args)]: [] };
    const answer = await agentsAnswer(home, scanRequest(), {
      now: NOW,
      cards: async () => [],
      sessionDeps: () => depsFor(home),
      scan: {
        scan: async () => full,
        heard: async () => null,
        lists: async () => lists,
        full: async () => full,
      },
    });
    lists = {};
    expect(answer.ok).toBe(true);
    expect(answer.agentsView).toBeUndefined();
    const [agent] = answer.agentsScan?.agents ?? [];
    expect(agent).toMatchObject({
      id: 'agt_claude-code',
      servers: 1,
      working: 1,
      open: 0,
    });
    // The program by file name only, since the path names the user.
    expect(agent?.mcp).toEqual([
      { name: 'github', command: 'npx', tools: 2, changing: 1 },
    ]);
    expect(agent?.capabilities?.total).toBe(1);
    expect(answer.agentsScan?.capabilities.total).toBe(1);
  });

  it('says counting rather than zero for a server never asked, and counts it behind the answer', async () => {
    const home = await homeWithSessions();
    let lists: ToolLists = {};
    let scanned = quick;
    let asked = 0;
    const seams = {
      scan: async () => scanned,
      heard: async () => null,
      lists: async () => lists,
      full: async () => {
        asked += 1;
        lists = { [toolListKey(GITHUB.command, GITHUB.args)]: [] };
        scanned = full;
        return full;
      },
    };
    const deps = {
      now: NOW,
      cards: async () => [],
      sessionDeps: () => depsFor(home),
      scan: seams,
    };
    const first = await agentsAnswer(home, scanRequest(), deps);
    expect(first.agentsScan?.capabilities.total).toBeUndefined();
    expect(first.agentsScan?.agents[0]?.capabilities?.total).toBeUndefined();
    expect(first.agentsScan?.agents[0]?.mcp?.[0]?.tools).toBeUndefined();

    await countedBehind(home);
    expect(asked).toBe(1);
    const second = await agentsAnswer(home, scanRequest(), deps);
    expect(second.agentsScan?.capabilities.total).toBe(1);
    await countedBehind(home);
    expect(asked).toBe(1);
  });

  it('is an empty scan, not a failure, on a machine with no agent', async () => {
    const home = await homeWithSessions();
    const answer = await agentsAnswer(home, scanRequest(), {
      now: NOW,
      cards: async () => [],
      sessionDeps: () => depsFor(home),
      scan: {
        scan: async () => null,
        heard: async () => null,
        lists: async () => ({}),
        full: async () => null,
      },
    });
    expect(answer.ok).toBe(true);
    expect(answer.agentsScan?.agents).toEqual([]);
  });

  it('is refused where nothing can read the sessions', async () => {
    const home = await homeWithSessions();
    const answer = await agentsAnswer(home, scanRequest(), {
      now: NOW,
      cards: async () => [],
    });
    expect(answer.ok).toBe(false);
  });
});
