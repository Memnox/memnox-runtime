import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERED_AGENT_KIND,
  emptyHub,
  HUB_MARKER,
  HUB_TRANSPORT,
  withAssignment,
  withServer,
  type Hub,
  type HubServer,
} from '@memnox/core';
import { syncHub } from '../src/mcp/hub-writer';

/**
 * A server given in one repository is written into each agent's config for that repository,
 * never into the agent's own config that every project reads, and taken back out the same way.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const CURSOR = DISCOVERED_AGENT_KIND.CURSOR;
const CLINE = DISCOVERED_AGENT_KIND.CLINE;

const LINEAR: HubServer = {
  name: 'linear',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: {},
  secrets: {},
};

const TEAM_SERVER = { command: 'node', args: ['team.js'] };

interface Machine {
  home: string;
  root: string;
}

async function machine(): Promise<Machine> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-project-servers-'));
  const root = await mkdtemp(join(tmpdir(), 'memnox-project-servers-repo-'));
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  await mkdir(join(home, '.cline'), { recursive: true });
  await writeFile(
    join(home, '.cline', 'settings.json'),
    JSON.stringify({ mcpServers: {} }),
  );
  await mkdir(join(root, '.cursor'), { recursive: true });
  await writeFile(
    join(root, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { team: TEAM_SERVER } }),
  );
  return { home, root };
}

async function json(path: string): Promise<Record<string, Record<string, unknown>>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
}

function givenIn(root: string): Hub {
  let hub = withServer(emptyHub(), LINEAR);
  for (const agent of [CLAUDE, CURSOR, CLINE])
    hub = withAssignment(hub, { server: 'linear', agent, project: root }, true);
  return hub;
}

describe('a server given in one project', () => {
  it("goes into each agent's config for that repository and nowhere every project reads", async () => {
    const { home, root } = await machine();
    await syncHub(home, givenIn(root));

    const cursor = await json(join(root, '.cursor', 'mcp.json'));
    expect(JSON.stringify(cursor['mcpServers']?.['linear'])).toContain(HUB_MARKER);
    expect(cursor['mcpServers']?.['team']).toEqual(TEAM_SERVER);
    const claude = await json(join(home, '.claude.json'));
    const projects = claude['projects'] as Record<string, Record<string, unknown>>;
    expect(JSON.stringify(projects[root]?.['mcpServers'])).toContain(HUB_MARKER);
    expect(claude['mcpServers']).toEqual({});
    expect((await json(join(home, '.cursor', 'mcp.json')))['mcpServers']).toEqual({});
    // Cline reads no per repository config, so it is not given the server at all.
    expect((await json(join(home, '.cline', 'settings.json')))['mcpServers']).toEqual({});
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(false);
  });

  it('is taken back out once nothing is given there, leaving the team its own server', async () => {
    const { home, root } = await machine();
    const given = await syncHub(home, givenIn(root));
    const taken = given.hub.assignments.reduce(
      (hub, each) => withAssignment(hub, each, false),
      given.hub,
    );
    const after = await syncHub(home, taken);

    const cursor = await json(join(root, '.cursor', 'mcp.json'));
    expect(cursor['mcpServers']).toEqual({ team: TEAM_SERVER });
    const claude = await json(join(home, '.claude.json'));
    const projects = claude['projects'] as Record<string, Record<string, unknown>>;
    expect(projects[root]?.['mcpServers']).toEqual({});
    expect(after.hub.written).toEqual([]);
  });
});
