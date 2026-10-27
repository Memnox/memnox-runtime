import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DisplayRequests,
  toolListKey,
  type ToolListCache,
  type ToolLists,
  type DiscoveryReport,
  type DisplayRequest,
} from '@memnox/core';
import { registerScanCommand } from '../src/commands/scan.command';
import { countedBehind, showAgentsTool } from '../src/session-tools/agents-tool';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { runCommand } from './cli-harness';
import { fakeSeams, FakeMachine, HOME, StubLister } from './machine-harness';

const NOW = new Date('2026-10-23T09:00:00.000Z');

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-agents-capabilities-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
    resolveCommand: () => null,
  };
}

const GITHUB = { name: 'github', command: 'npx', args: ['github-mcp'] };

/** The machine before any full scan: one server nobody has asked. */
const quick = {
  agents: [{ id: 'agt_claude-code', kind: 'claude-code' }],
  surfaces: [{ agentId: 'agt_claude-code', kind: 'mcp', servers: [GITHUB] }],
  authenticated: [],
} as unknown as DiscoveryReport;

/** The same machine once the server has been asked. */
const full = {
  ...quick,
  surfaces: [
    {
      agentId: 'agt_claude-code',
      kind: 'mcp',
      servers: [GITHUB],
      tools: [
        { server: 'github', name: 'merge_pull_request', effect: 'write' },
        { server: 'github', name: 'delete_branch', effect: 'destructive' },
        { server: 'github', name: 'list_issues', effect: 'read' },
      ],
    },
  ],
} as unknown as DiscoveryReport;

async function shown(home: string): Promise<DisplayRequest[]> {
  return new DisplayRequests(home).open(NOW.toISOString());
}

describe('the real capabilities on the scan screen', () => {
  it('says counting rather than zero with no full scan yet, then puts the counted figure up', async () => {
    const deps = await depsAt();
    let asked = 0;
    const result = (await showAgentsTool(
      deps,
      {},
      {
        scan: async () => quick,
        heard: async () => null,
        lists: async () => ({}),
        full: async () => {
          asked += 1;
          return full;
        },
      },
    )) as { capabilities: { total?: number }; said: string };

    expect(result.capabilities.total).toBeUndefined();
    expect(result.said).toContain('still being counted');

    await countedBehind(deps.home);
    expect(asked).toBe(1);
    const [request] = await shown(deps.home);
    expect(request?.capabilities).toEqual({
      total: 2,
      areas: [{ area: 'code', count: 2 }],
    });
    expect(request?.agents?.[0]?.capabilities?.total).toBe(2);
    expect(request?.agents?.[0]?.mcp).toEqual([
      { name: 'github', tools: 3, changing: 2 },
    ]);
  });

  it('never draws a zero while counting, on the machine or on any agent', async () => {
    const deps = await depsAt();
    await showAgentsTool(
      deps,
      {},
      // A full scan that never lands leaves the screen counting, which stays true.
      {
        scan: async () => quick,
        heard: async () => null,
        lists: async () => ({}),
        full: async () => new Promise(() => undefined),
      },
    );
    const [request] = await shown(deps.home);
    expect(request?.capabilities).toEqual({ areas: [] });
    expect(
      request?.agents?.every((agent) => agent.capabilities?.total === undefined),
    ).toBe(true);
  });

  it('counts at once and starts nothing when every server was asked before', async () => {
    const deps = await depsAt();
    let asked = 0;
    const result = (await showAgentsTool(
      deps,
      {},
      {
        scan: async () => full,
        heard: async () => null,
        lists: async () => ({ [toolListKey(GITHUB.command, GITHUB.args)]: [] }),
        full: async () => {
          asked += 1;
          return full;
        },
      },
    )) as { capabilities: { total?: number }; said: string };
    expect(result.capabilities.total).toBe(2);
    expect(result.said).toContain('2 real capabilities, across code');
    await countedBehind(deps.home);
    expect(asked).toBe(0);
  });
});

/** What a full scan kept, held in memory so a test never writes the real home. */
class MemoryToolLists implements ToolListCache {
  lists: ToolLists = {};

  async read(): Promise<ToolLists> {
    return this.lists;
  }

  async merge(lists: ToolLists): Promise<void> {
    this.lists = { ...this.lists, ...lists };
  }
}

const MACHINE = {
  [`${HOME}/.claude.json`]: JSON.stringify({
    mcpServers: { github: { command: 'npx', args: ['github-mcp'] } },
  }),
};

describe('the real capabilities in memnox scan', () => {
  const lister = (): StubLister =>
    new StubLister([
      { name: 'merge_pull_request' },
      { name: 'delete_repo' },
      { name: 'get_issue' },
    ]);

  async function scan(args: string[], toolLists: MemoryToolLists): Promise<string> {
    const machine = FakeMachine.from(MACHINE);
    const { out } = await runCommand(
      (program, context) =>
        registerScanCommand(program, context, {
          buildSeams: () => ({ ...fakeSeams(machine, { lister }), toolLists }),
        }),
      args,
    );
    return out.text;
  }

  it('puts the count and its areas in --json', async () => {
    const json = JSON.parse(await scan(['scan', '--json'], new MemoryToolLists())) as {
      capabilities: unknown;
    };
    expect(json.capabilities).toEqual({ total: 2, areas: [{ area: 'code', count: 2 }] });
  });

  it('says what the capabilities reach under the count', async () => {
    const text = await scan(['scan'], new MemoryToolLists());
    expect(text).toContain('2 capabilities can change something outside this laptop.');
    expect(text).toContain('They reach code.');
  });

  it('without a probe, says uncounted rather than zero until a full scan has asked', async () => {
    const kept = new MemoryToolLists();
    const before = await scan(['scan', '--no-probe'], kept);
    expect(before).not.toContain('0 capabilities');
    expect(before).toContain('not counted');
    const json = JSON.parse(await scan(['scan', '--no-probe', '--json'], kept)) as {
      capabilities: { total?: number };
    };
    expect(json.capabilities.total).toBeUndefined();

    await scan(['scan'], kept);
    const after = JSON.parse(await scan(['scan', '--no-probe', '--json'], kept)) as {
      capabilities: unknown;
    };
    expect(after.capabilities).toEqual({ total: 2, areas: [{ area: 'code', count: 2 }] });
  });
});
