import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  areaOf,
  areaPhrase,
  capabilitiesOf,
  creditedTallies,
  tallyOf,
} from '../src/discovery/capabilities';
import type { DiscoveryReport } from '../src/discovery/discover';
import { reachingActions } from '../src/discovery/gap';
import type { EnvironmentSnapshot } from '../src/discovery/snapshot';
import {
  CachedMcpLister,
  NodeToolListCache,
  RecordingMcpLister,
  toolListKey,
  unaskedServers,
} from '../src/discovery/tool-lists';
import { inferToolEffect } from '../src/discovery/surface';
import { verbTableFor } from '../src/verbs/tables';
import { externalStateVerbs } from '../src/verbs/verb-table';

const report = (over: Partial<DiscoveryReport> = {}): DiscoveryReport =>
  ({
    agents: [
      { id: 'agt_claude', kind: 'claude-code' },
      { id: 'agt_cursor', kind: 'cursor' },
    ],
    surfaces: [
      { agentId: 'agt_claude', kind: 'shell', detectedFrom: '.zshrc' },
      {
        agentId: 'agt_claude',
        kind: 'mcp',
        detectedFrom: '.claude.json',
        tools: [
          { server: 'github', name: 'merge_pull_request', effect: 'write' },
          { server: 'github', name: 'get_issue', effect: 'read' },
          { server: 'slack', name: 'post_message', effect: 'write' },
          { server: 'gateway', name: 'refund_payment', effect: 'destructive' },
          { server: 'notes', name: 'frobnicate', effect: 'unknown' },
        ],
        servers: [],
      },
      {
        agentId: 'agt_cursor',
        kind: 'mcp',
        detectedFrom: '.cursor/mcp.json',
        tools: [
          { server: 'github', name: 'merge_pull_request', effect: 'write' },
          { server: 'supabase', name: 'execute_sql', effect: 'destructive' },
        ],
        servers: [],
      },
    ],
    authenticated: [{ name: 'stripe' }, { name: 'stripe' }, { name: 'unknown-cli' }],
    ...over,
  }) as unknown as DiscoveryReport;

const stripeVerbs = (): number => {
  const table = verbTableFor('stripe');
  return table === null ? 0 : externalStateVerbs(table).length;
};

describe('the capability count', () => {
  it('counts write and destructive MCP tools once each, and the write verbs of each signed in CLI', () => {
    const all = capabilitiesOf(report());
    const mcp = all.filter((each) => each.action.startsWith('mcp.'));
    // merge_pull_request is held by two agents and counted once; a read or an unknown is never counted.
    expect(mcp.map((each) => each.action).sort()).toEqual([
      'mcp.execute_sql',
      'mcp.merge_pull_request',
      'mcp.post_message',
      'mcp.refund_payment',
    ]);
    expect(stripeVerbs()).toBeGreaterThan(0);
    expect(all.filter((each) => each.via === 'stripe')).toHaveLength(stripeVerbs());
    expect(all).toHaveLength(4 + stripeVerbs());
  });

  it('is the same count the scan closes on', () => {
    expect(reachingActions(report())).toHaveLength(capabilitiesOf(report()).length);
  });

  it('credits a signed in CLI only to an agent with a shell', () => {
    const verbs = capabilitiesOf(report()).filter((each) => each.via === 'stripe');
    expect(verbs.every((each) => each.agentIds.join() === 'agt_claude')).toBe(true);
  });

  it('groups by area, placing a vaguely named server by its tool', () => {
    const tally = tallyOf(capabilitiesOf(report()));
    expect(tally.total).toBe(4 + stripeVerbs());
    expect(tally.areas).toEqual([
      { area: 'code', count: 1 },
      { area: 'databases', count: 1 },
      { area: 'payments', count: 1 + stripeVerbs() },
      { area: 'chat', count: 1 },
    ]);
    expect(areaPhrase(tally.areas)).toBe(
      "code, databases, payments and your team's chat",
    );
  });

  it('places the CLIs the verb tables know', () => {
    expect(areaOf('psql')).toBe('databases');
    expect(areaOf('gh')).toBe('code');
    expect(areaOf('kubectl')).toBe('cloud');
    expect(areaOf('stripe')).toBe('payments');
    expect(areaOf('playwright')).toBe('other');
  });

  it('credits each capability to one agent, so the agents add up to the machine', () => {
    const all = capabilitiesOf(report());
    const credited = creditedTallies(all, ['agt_claude', 'agt_cursor']);
    const sum = [...credited.values()].reduce(
      (total, each) => total + (each.total ?? 0),
      0,
    );
    expect(sum).toBe(all.length);
    // Cursor's merge was already credited to Claude Code; only its SQL tool is its own.
    expect(credited.get('agt_cursor')).toEqual({
      total: 1,
      areas: [{ area: 'databases', count: 1 }],
    });
  });

  it('leaves the total out while still counting, never a zero', () => {
    const tally = tallyOf([], false);
    expect(tally.total).toBeUndefined();
    expect('total' in tally).toBe(false);
    const credited = creditedTallies(capabilitiesOf(report()), ['agt_claude'], false);
    expect(credited.get('agt_claude')?.total).toBeUndefined();
  });

  it('says nothing about areas when there are none', () => {
    expect(areaPhrase([])).toBeNull();
    expect(areaPhrase([{ area: 'cloud', count: 2 }])).toBe('cloud');
  });
});

describe('the kept tool lists', () => {
  const launch = { name: 'github', command: 'npx', args: ['-y', 'github-mcp'] };
  const declared = [
    { name: 'merge_pull_request', annotations: { readOnlyHint: false } },
    { name: 'list_issues', annotations: { readOnlyHint: true } },
    { name: 'delete_repo', annotations: { destructiveHint: true } },
    { name: 'frobnicate' },
  ];

  it('keeps what a full scan heard under the launch line, and answers it back with the same effects', async () => {
    const recording = new RecordingMcpLister({ listTools: async () => declared });
    await recording.listTools(launch.name, launch.command, launch.args);
    const cached = new CachedMcpLister(recording.heard);
    const again = await cached.listTools(launch.name, launch.command, launch.args);
    expect(again.map((each) => inferToolEffect(each).effect)).toEqual(
      declared.map((each) => inferToolEffect(each).effect),
    );
    expect(cached.missed).toEqual([]);
  });

  it('names a server nothing asked as a miss rather than a server with no tools', async () => {
    const cached = new CachedMcpLister({});
    expect(await cached.listTools('linear', 'npx', ['linear-mcp'])).toEqual([]);
    expect(cached.missed).toEqual(['linear']);
  });

  it('treats a changed launch line as a different server', () => {
    expect(toolListKey('npx', ['a'])).not.toBe(toolListKey('npx', ['b']));
  });

  it('answers from the last snapshot for a server asked before lists were kept', async () => {
    const snapshot = {
      servers: [
        { name: 'github', tools: [{ name: 'merge_pull_request', effect: 'write' }] },
      ],
    } as unknown as EnvironmentSnapshot;
    const cached = new CachedMcpLister({}, snapshot);
    const tools = await cached.listTools(launch.name, launch.command, launch.args);
    expect(tools.map((each) => inferToolEffect(each).effect)).toEqual(['write']);
  });

  it('finds the switched on servers nothing has asked', () => {
    const surfaces = [
      {
        agentId: 'agt_claude',
        kind: 'mcp',
        detectedFrom: '.claude.json',
        servers: [
          launch,
          { name: 'linear', command: 'npx', args: ['linear-mcp'] },
          { name: 'off', command: 'npx', args: ['off'], disabled: true },
        ],
      },
    ] as unknown as DiscoveryReport['surfaces'];
    const lists = { [toolListKey(launch.command, launch.args)]: [] };
    expect(unaskedServers(surfaces, lists, null)).toEqual(['linear']);
    expect(unaskedServers(surfaces, {}, null)).toEqual(['github', 'linear']);
  });

  it('merges a scan into what was kept on disk, and never writes the launch line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-tool-lists-'));
    const cache = new NodeToolListCache(home);
    expect(await cache.read()).toEqual({});
    await cache.merge({ a: [{ name: 'x', effect: 'write' }] });
    await cache.merge({ b: [] });
    const kept = await cache.read();
    expect(Object.keys(kept).sort()).toEqual(['a', 'b']);
    expect(JSON.stringify(kept)).not.toContain('github-mcp');
  });
});
