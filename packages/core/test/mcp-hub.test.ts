import { describe, expect, it } from 'vitest';
import {
  emptyHub,
  HUB_TRANSPORT,
  hubServerProblems,
  withAssignment,
  withoutServer,
  withServer,
  type Hub,
  type HubServer,
} from '../src/mcp/registry';
import { resolveSecretRefs, secretNameOf, secretRef } from '../src/mcp/secret-ref';
import {
  DRIFT,
  entryDigest,
  entryFor,
  HUB_MARKER,
  planSync,
  writtenAfter,
  type ConfigServers,
} from '../src/mcp/sync-plan';
import { CONFIG_FORMAT } from '../src/discovery/wrap-text';
import {
  DISCOVERED_AGENT_KIND,
  type DiscoveredAgentKind,
} from '../src/discovery/discovery.constants';
import { PROXY_BINARY, unwrapLaunch, type ServerLaunch } from '../src/discovery/wrap';

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const CODEX = DISCOVERED_AGENT_KIND.CODEX_CLI;
const CLAUDE_FILE = '/home/me/.claude.json';
const CODEX_FILE = '/home/me/.codex/config.toml';

function github(overrides: Partial<HubServer> = {}): HubServer {
  return {
    name: 'github',
    transport: HUB_TRANSPORT.STDIO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {},
    secrets: { GITHUB_TOKEN: 'github-token' },
    ...overrides,
  };
}

function hubWith(server: HubServer, ...agents: DiscoveredAgentKind[]): Hub {
  let hub = withServer(emptyHub(), server);
  for (const agent of agents)
    hub = withAssignment(hub, { server: server.name, agent }, true);
  return hub;
}

function claudeConfig(servers: Record<string, unknown> = {}): ConfigServers {
  return { path: CLAUDE_FILE, format: CONFIG_FORMAT.JSON, agent: CLAUDE, servers };
}

describe('a hub server', () => {
  it('is accepted when it names a command and a valid secret', () => {
    expect(hubServerProblems(github())).toEqual([]);
  });

  it('says what is wrong rather than throwing', () => {
    const problems = hubServerProblems(
      github({ name: 'has space', command: ' ', env: { GITHUB_TOKEN: 'x' } }),
    );
    expect(problems).toHaveLength(3);
  });

  it('refuses a remote server on a scheme no agent speaks', () => {
    const remote = github({
      transport: HUB_TRANSPORT.HTTP,
      url: 'ftp://example.com',
      command: undefined,
    });
    expect(hubServerProblems(remote)).toEqual([
      'A remote server is reached over http or https.',
    ]);
  });

  it('drops its assignments when it is removed', () => {
    const hub = withoutServer(hubWith(github(), CLAUDE), 'github');
    expect(hub.assignments).toEqual([]);
  });
});

describe('a secret reference', () => {
  it('names the secret and never carries its value', () => {
    expect(secretRef('github-token')).toBe('memnox-secret:github-token');
    expect(secretNameOf('memnox-secret:github-token')).toBe('github-token');
    expect(secretNameOf('ghp_plain')).toBeUndefined();
  });

  it('is swapped for the held value and a missing one is named, not passed on', async () => {
    const held: Record<string, string> = { 'github-token': 'value-from-keychain' };
    const resolved = await resolveSecretRefs(
      {
        GITHUB_TOKEN: secretRef('github-token'),
        SLACK: secretRef('slack-token'),
        PLAIN: 'kept',
      },
      async (name) => held[name],
    );
    expect(resolved.env).toEqual({ GITHUB_TOKEN: 'value-from-keychain', PLAIN: 'kept' });
    expect(resolved.missing).toEqual([{ variable: 'SLACK', secret: 'slack-token' }]);
  });
});

describe('the line an agent is given', () => {
  it('starts the server behind the proxy, marked as the hub’s, with only a reference to the secret', () => {
    const entry = entryFor(github(), CLAUDE) as ServerLaunch;
    expect(entry.command).toBe(PROXY_BINARY);
    expect(entry.args).toContain(HUB_MARKER);
    expect(entry.env).toEqual({ GITHUB_TOKEN: 'memnox-secret:github-token' });
    expect(unwrapLaunch(entry)).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'memnox-secret:github-token' },
    });
  });
});

describe('a sync', () => {
  it('adds a server only to the agents it was given to', () => {
    const hub = hubWith(github(), CLAUDE);
    const codex: ConfigServers = {
      path: CODEX_FILE,
      format: CONFIG_FORMAT.TOML,
      agent: CODEX,
      servers: {},
    };
    const plan = planSync(hub, [claudeConfig(), codex]);
    expect(plan.files[0]?.add.map((each) => each.name)).toEqual(['github']);
    expect(plan.files[1]?.add).toEqual([]);
  });

  it('reports a server the person wrote as found and never touches it', () => {
    const plan = planSync(hubWith(github(), CLAUDE), [
      claudeConfig({ notion: { command: 'npx', args: ['notion-mcp'] } }),
    ]);
    expect(plan.files[0]?.found).toEqual(['notion']);
    expect(plan.files[0]?.remove).toEqual([]);
  });

  it('waits rather than overwrite a server of the same name the person configured', () => {
    const plan = planSync(hubWith(github(), CLAUDE), [
      claudeConfig({ github: { command: 'docker', args: ['run', 'gh'] } }),
    ]);
    expect(plan.files[0]?.add).toEqual([]);
    expect(plan.files[0]?.skipped.map((each) => each.name)).toEqual(['github']);
  });

  it('updates its own line when the server changes, and removes it when unassigned', () => {
    const first = hubWith(github(), CLAUDE);
    const applied = planSync(first, [claudeConfig()]);
    const written = { ...first, written: writtenAfter(first, applied) };
    const onDisk = { github: applied.files[0]?.add[0]?.entry };

    const changed = withServer(written, github({ args: ['-y', 'server-github@2'] }));
    expect(
      planSync(changed, [claudeConfig(onDisk)]).files[0]?.update.map((each) => each.name),
    ).toEqual(['github']);

    const unassigned = withAssignment(
      written,
      { server: 'github', agent: CLAUDE },
      false,
    );
    expect(planSync(unassigned, [claudeConfig(onDisk)]).files[0]?.remove).toEqual([
      'github',
    ]);
  });

  it('leaves a line the person edited or removed, and says so', () => {
    const hub = hubWith(github(), CLAUDE);
    const applied = planSync(hub, [claudeConfig()]);
    const written = { ...hub, written: writtenAfter(hub, applied) };

    const edited = planSync(written, [
      claudeConfig({ github: { command: 'npx', args: ['mine'] } }),
    ]);
    expect(edited.files[0]?.drifted).toEqual([{ name: 'github', kind: DRIFT.EDITED }]);
    expect(edited.files[0]?.update).toEqual([]);

    const removed = planSync(written, [claudeConfig()]);
    expect(removed.files[0]?.drifted).toEqual([{ name: 'github', kind: DRIFT.REMOVED }]);
    expect(removed.files[0]?.add).toEqual([]);
  });

  it('does not read a text config’s missing environment as an edit', () => {
    const hub = hubWith(github(), CODEX);
    const entry = entryFor(github(), CODEX) as ServerLaunch;
    const readBack = { command: entry.command, args: entry.args };
    expect(entryDigest(readBack, CONFIG_FORMAT.TOML)).toBe(
      entryDigest(entry, CONFIG_FORMAT.TOML),
    );
    const written = {
      ...hub,
      written: [
        {
          path: CODEX_FILE,
          server: 'github',
          digest: entryDigest(entry, CONFIG_FORMAT.TOML),
        },
      ],
    };
    const plan = planSync(written, [
      {
        path: CODEX_FILE,
        format: CONFIG_FORMAT.TOML,
        agent: CODEX,
        servers: { github: readBack },
      },
    ]);
    expect(plan.files[0]?.drifted).toEqual([]);
    expect(plan.files[0]?.update).toEqual([]);
  });

  it('skips a remote server for an agent whose format it cannot write yet', () => {
    const remote = github({
      transport: HUB_TRANSPORT.HTTP,
      url: 'https://mcp.example.com',
      command: undefined,
    });
    const plan = planSync(hubWith(remote, CODEX), [
      { path: CODEX_FILE, format: CONFIG_FORMAT.TOML, agent: CODEX, servers: {} },
    ]);
    expect(plan.files[0]?.skipped.map((each) => each.name)).toEqual(['github']);
  });

  it('only reports on a file several agents share', () => {
    const plan = planSync(hubWith(github(), CLAUDE), [
      {
        path: '/repo/.mcp.json',
        format: CONFIG_FORMAT.JSON,
        shared: true,
        servers: { db: {} },
      },
    ]);
    expect(plan.files[0]).toMatchObject({ add: [], remove: [], found: ['db'] });
  });
});
