import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  emptyHub,
  HUB_TRANSPORT,
  MCP_SCOPE,
  orgServersFrom,
  readOrgServers,
  withOrganization,
  type DaemonRequest,
  type DaemonResponse,
  type SecretStore,
} from '@memnox/core';
import { mcpHubAnswer } from '../src/daemon/mcp-hub-answer';
import { applyBundle, PULL_OUTCOME, type Bundle } from '../src/sync/bundle';

/**
 * The organization's MCP servers arrive with the bundle, are handed to the agents they name like
 * hub servers, and are shown as the organization's: never edited, removed or reassigned here.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const LINEAR = {
  name: 'linear',
  description: 'Issues',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: {},
  secrets: { LINEAR_TOKEN: 'linear-token' },
  agents: ['claude-code'],
};

function bundleWith(mcpServers: unknown[] | undefined): Bundle {
  return {
    hash: 'h1',
    policies: [],
    rules: [],
    conditions: [],
    tags: [],
    ...(mcpServers === undefined ? {} : { mcpServers }),
  };
}

const NO_SECRETS: SecretStore = {
  get: async () => undefined,
  set: async () => undefined,
  remove: async () => undefined,
};

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'memnox-org-mcp-'));
  await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  return dir;
}

function ask(dir: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  const full = { id: 1, method: DAEMON_METHOD.HUB, ...request } as DaemonRequest;
  return mcpHubAnswer(dir, full, { now: NOW, remote: false, secrets: NO_SECRETS });
}

async function claudeServers(dir: string): Promise<Record<string, unknown>> {
  const config = JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  return config.mcpServers;
}

describe('organization MCP servers', () => {
  it('keep only what the hub could write, and leave a local server of the same name alone', () => {
    const read = orgServersFrom([LINEAR, { name: 'broken', transport: 'smoke' }]);
    expect(read.map((each) => each.name)).toEqual(['linear']);

    const local = { ...LINEAR, command: 'mine', agents: undefined };
    const hub = withOrganization({ ...emptyHub(), servers: [local] }, read);
    expect(hub.servers).toEqual([local]);
    expect(hub.assignments).toEqual([]);
  });

  it('are written into the agents they name when a bundle carries them, and taken out when it stops', async () => {
    const dir = await home();

    const applied = await applyBundle(dir, bundleWith([LINEAR]));

    expect(applied.outcome).toBe(PULL_OUTCOME.APPLIED);
    expect(await readOrgServers(dir)).toHaveLength(1);
    expect(Object.keys(await claudeServers(dir))).toEqual(['linear']);

    await applyBundle(dir, bundleWith(undefined));
    expect(await claudeServers(dir)).toEqual({});
  });

  it('show on the hub as the organization scope, and refuse every change from this machine', async () => {
    const dir = await home();
    await applyBundle(dir, bundleWith([LINEAR]));

    const view = await ask(dir, {});
    expect(view.mcpHub?.servers).toMatchObject([
      { name: 'linear', scope: MCP_SCOPE.ORGANIZATION, agents: ['claude-code'] },
    ]);
    const { agents: _agents, ...server } = LINEAR;
    const put = await ask(dir, { method: DAEMON_METHOD.SERVER_PUT, mcpServer: server });
    const removed = await ask(dir, {
      method: DAEMON_METHOD.SERVER_REMOVE,
      mcpServerName: 'linear',
    });
    const taken = await ask(dir, {
      method: DAEMON_METHOD.ASSIGN,
      mcpServerName: 'linear',
      mcpAgent: 'claude-code',
      mcpOn: false,
    });
    for (const answer of [put, removed, taken]) {
      expect(answer.ok).toBe(false);
      expect(answer.reason).toMatch(/organization's server/);
    }
    expect(Object.keys(await claudeServers(dir))).toEqual(['linear']);
  });
});
