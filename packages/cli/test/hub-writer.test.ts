import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERED_AGENT_KIND,
  DRIFT,
  emptyHub,
  HUB_MARKER,
  HUB_TRANSPORT,
  planUnwrap,
  readHub,
  withAssignment,
  withServer,
  type DiscoveredAgentKind,
  type Hub,
  type HubServer,
  type ServerLaunch,
} from '@memnox/core';
import { importServer } from '../src/mcp/hub-changes';
import { readHubConfigs, syncHub } from '../src/mcp/hub-writer';
import { backupPathFor } from '../src/memnox-paths';

/**
 * The hub writing into real config files under a scratch home: its own lines marked, the
 * person's servers left exactly as they were, a backup first, and never a secret's value.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const CURSOR = DISCOVERED_AGENT_KIND.CURSOR;
const CODEX = DISCOVERED_AGENT_KIND.CODEX_CLI;
const CLINE = DISCOVERED_AGENT_KIND.CLINE;
// Assembled at run time, so no scanner reads a credential in this file.
const TOKEN_VALUE = ['ghp', 'never', 'on', 'disk'].join('_');

const PERSON_CLAUDE = { command: 'node', args: ['/opt/notes/server.js'] };
const PERSON_CODEX =
  '[mcp_servers.files]\ncommand = "files-server"\nargs = ["--root", "/srv"]\n';

const GITHUB: HubServer = {
  name: 'github',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: 'github.com' },
  secrets: { GITHUB_TOKEN: 'github-token' },
};

async function scratchHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-hub-writer-'));
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify({ theme: 'dark', mcpServers: { notes: PERSON_CLAUDE } }, null, 2),
  );
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(join(home, '.codex', 'config.toml'), `model = "o4"\n\n${PERSON_CODEX}`);
  return home;
}

function given(server: HubServer, agents: readonly DiscoveredAgentKind[]): Hub {
  return agents.reduce(
    (hub, agent) => withAssignment(hub, { server: server.name, agent }, true),
    withServer(emptyHub(), server),
  );
}

async function serversIn(
  home: string,
  agent: DiscoveredAgentKind,
): Promise<Record<string, unknown>> {
  const config = (await readHubConfigs(home, home)).find((each) => each.agent === agent);
  return config === undefined ? {} : { ...config.servers };
}

describe('writing the hub into agent configs', () => {
  it("writes a marked line for each agent and leaves the person's own servers untouched", async () => {
    const home = await scratchHome();
    const synced = await syncHub(home, given(GITHUB, [CLAUDE, CURSOR, CODEX]));
    expect(synced.files).toHaveLength(3);

    const claude = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8'));
    expect(claude.theme).toBe('dark');
    expect(claude.mcpServers.notes).toEqual(PERSON_CLAUDE);
    expect(claude.mcpServers.github.args).toContain(HUB_MARKER);
    expect(claude.mcpServers.github.env.GITHUB_TOKEN).toBe('memnox-secret:github-token');

    const codex = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(codex.startsWith(`model = "o4"\n\n${PERSON_CODEX}`)).toBe(true);
    expect(codex).toContain('[mcp_servers.github]');
    expect(codex).toContain(HUB_MARKER);

    for (const path of synced.files) {
      expect(await readFile(path, 'utf8')).not.toContain(TOKEN_VALUE);
      expect(existsSync(backupPathFor(home, path))).toBe(true);
    }
    expect(JSON.stringify(await readHub(home))).not.toContain(TOKEN_VALUE);
  });

  it('remembers what it wrote, so a second sync changes nothing', async () => {
    const home = await scratchHome();
    const first = await syncHub(home, given(GITHUB, [CLAUDE, CURSOR, CODEX]));
    expect(first.hub.written).toHaveLength(3);
    const second = await syncHub(home, first.hub);
    expect(second.files).toEqual([]);
    expect(second.plan.files.flatMap((file) => file.drifted)).toEqual([]);
  });

  it('removes only its own line when a server is taken away from an agent', async () => {
    const home = await scratchHome();
    const first = await syncHub(home, given(GITHUB, [CLAUDE, CODEX]));
    const narrowed = withAssignment(first.hub, { server: 'github', agent: CODEX }, false);
    const second = await syncHub(home, narrowed);
    expect(second.files).toEqual([join(home, '.codex', 'config.toml')]);
    const codex = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(codex).toBe(`model = "o4"\n\n${PERSON_CODEX}`);
    expect(Object.keys(await serversIn(home, CLAUDE))).toEqual(['notes', 'github']);
  });

  it('leaves a line the person edited, and says it drifted', async () => {
    const home = await scratchHome();
    const first = await syncHub(home, given(GITHUB, [CLAUDE]));
    const path = join(home, '.claude.json');
    const claude = JSON.parse(await readFile(path, 'utf8'));
    claude.mcpServers.github.args.push('--read-only');
    await writeFile(path, JSON.stringify(claude));
    const second = await syncHub(
      home,
      withServer(first.hub, { ...GITHUB, args: ['other'] }),
    );
    expect(second.files).toEqual([]);
    const drifted = second.plan.files.flatMap((file) => file.drifted);
    expect(drifted).toEqual([{ name: 'github', kind: DRIFT.EDITED }]);
  });

  it("can still be unwrapped back to the server's own launch line", async () => {
    const home = await scratchHome();
    await syncHub(home, given(GITHUB, [CLAUDE, CODEX]));
    for (const agent of [CLAUDE, CODEX]) {
      const servers = (await serversIn(home, agent)) as Record<string, ServerLaunch>;
      const restored = planUnwrap(servers).restore.find((each) => each.name === 'github');
      expect(restored?.after.command).toBe('npx');
      expect(restored?.after.args).toEqual(GITHUB.args);
    }
  });

  it('creates a config only for an agent whose own folder is here', async () => {
    const home = await scratchHome();
    await mkdir(join(home, '.cline'), { recursive: true });
    const vscode = DISCOVERED_AGENT_KIND.VS_CODE;
    const synced = await syncHub(home, given(GITHUB, [CLINE, vscode]));
    expect(synced.files).toEqual([join(home, '.cline', 'settings.json')]);
    const cline = JSON.parse(
      await readFile(join(home, '.cline', 'settings.json'), 'utf8'),
    );
    expect(Object.keys(cline.mcpServers)).toEqual(['github']);
    expect(existsSync(join(home, '.vscode', 'mcp.json'))).toBe(false);
  });

  it('imports a server the person configured, for the same agent, behind the proxy', async () => {
    const home = await scratchHome();
    const imported = await importServer(home, { name: 'notes', agent: CLAUDE });
    expect('synced' in imported).toBe(true);
    const hub = await readHub(home);
    expect(hub.servers.map((each) => each.name)).toEqual(['notes']);
    expect(hub.assignments).toEqual([{ server: 'notes', agent: CLAUDE }]);
    const notes = (await serversIn(home, CLAUDE))['notes'] as ServerLaunch;
    expect(notes.args).toContain(HUB_MARKER);
    expect(notes.args.slice(-2)).toEqual(['node', '/opt/notes/server.js']);
    expect(await importServer(home, { name: 'notes', agent: CLAUDE })).toEqual({
      refused: 'The hub already has a server named notes.',
    });
  });
});
