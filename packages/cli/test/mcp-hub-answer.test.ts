import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  DISCOVERED_AGENT_KIND,
  entryFor,
  HUB_TRANSPORT,
  HUB_VERSION,
  MCP_HEALTH,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  proposalCapability,
  readHub,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  writeHub,
  type DaemonRequest,
  type DaemonResponse,
  type HubServer,
  type SecretStore,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { isMcpHubMethod, mcpHubAnswer } from '../src/daemon/mcp-hub-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/**
 * The hub's daemon methods: a widening change waits on a signed proposal, a narrowing one is
 * done at once, and no answer ever carries a secret's value.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const DESKTOP = DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP;
// Assembled at run time, so no scanner reads a credential in this file.
const TOKEN_VALUE = ['ghp', 'only', 'in', 'the', 'store'].join('_');

const GITHUB: HubServer = {
  name: 'github',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'server-github'],
  env: {},
  secrets: { GITHUB_TOKEN: 'github-token' },
};

function memoryStore(): SecretStore {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => {
      held.set(name, value);
    },
    remove: async (name) => {
      held.delete(name);
    },
  };
}

interface Fixture {
  home: string;
  secrets: SecretStore;
  ask(request: Partial<DaemonRequest>, remote?: boolean): Promise<DaemonResponse>;
  signed(subject: string): string;
}

async function fixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-hub-answer-'));
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify({ mcpServers: { notes: { command: 'node', args: ['n.js'] } } }),
  );
  const secrets = memoryStore();
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  const lister = {
    listTools: async () => [{ name: 'create_issue', description: 'Opens an issue' }],
  };
  let id = 0;
  return {
    home,
    secrets,
    ask: (request, remote = false) => {
      id += 1;
      const full = { id, method: DAEMON_METHOD.HUB, ...request } as DaemonRequest;
      return mcpHubAnswer(home, full, {
        now: NOW,
        remote,
        secrets,
        listerFor: () => lister,
      });
    },
    signed: (subject) =>
      sign(
        'sha256',
        Buffer.from(confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED)),
        privateKey,
      ).toString('base64'),
  };
}

async function confirmed(at: Fixture, subject: string): Promise<void> {
  const result = await confirmAnswer(at.home, {
    subject,
    answer: PROPOSAL_ANSWER.CONFIRMED,
    signature: at.signed(subject),
    at: NOW.toISOString(),
  });
  expect(result).toMatchObject({ ok: true });
}

describe('the MCP Hub methods', () => {
  it('are voice methods a phone may read and propose through, never set a secret through', () => {
    expect(isMcpHubMethod('mcp-hub')).toBe(true);
    expect(isVoiceMethod('mcp-server-put')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.HUB)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.SERVER_PUT)).toBe(REMOTE_CAPABILITY.ASK);
    expect(remoteCapabilityFor(DAEMON_METHOD.SECRET_SET)).toBeNull();
    expect(
      proposalCapability({ kind: PROPOSAL_KIND.MCP_HUB, hub: { put: GITHUB } }),
    ).toBe(REMOTE_CAPABILITY.RULES);
  });

  it('shows what the person configured as found before anything is added', async () => {
    const at = await fixture();
    const answer = await at.ask({});
    expect(answer.ok).toBe(true);
    expect(answer.mcpHub?.servers).toEqual([]);
    expect(answer.mcpHub?.found).toEqual([
      { agent: CLAUDE, path: join(at.home, '.claude.json'), name: 'notes' },
    ]);
    expect(answer.mcpHub?.agents.map((each) => each.agent)).toEqual([CLAUDE]);
  });

  it('proposes a server rather than adding it, and adds it once the person signs', async () => {
    const at = await fixture();
    const put = await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB });
    expect(put.proposed).toMatch(/^prp_/);
    expect((await readHub(at.home)).servers).toEqual([]);
    const proposal = await new Proposals(at.home).read(put.proposed ?? '');
    expect(proposal?.change).toEqual({
      kind: PROPOSAL_KIND.MCP_HUB,
      hub: { put: GITHUB },
    });
    await confirmed(at, put.proposed ?? '');
    expect((await readHub(at.home)).servers).toEqual([GITHUB]);
  });

  it('refuses an unsigned yes to a hub proposal', async () => {
    const at = await fixture();
    const put = await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB });
    const result = await confirmAnswer(at.home, {
      subject: put.proposed ?? '',
      answer: PROPOSAL_ANSWER.CONFIRMED,
      at: NOW.toISOString(),
    });
    expect(result.ok).toBe(false);
    expect((await readHub(at.home)).servers).toEqual([]);
  });

  it('refuses a server whose shape or name will not do', async () => {
    const at = await fixture();
    const bad = await at.ask({
      method: DAEMON_METHOD.SERVER_PUT,
      mcpServer: { ...GITHUB, name: '../x' },
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('A name is letters');
  });

  it('gives a server to an agent only once signed, and takes it away at once', async () => {
    const at = await fixture();
    await confirmed(
      at,
      (await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB })).proposed ??
        '',
    );
    const on = await at.ask({
      method: DAEMON_METHOD.ASSIGN,
      mcpServerName: 'github',
      mcpAgent: CLAUDE,
      mcpOn: true,
    });
    expect(on.proposed).toMatch(/^prp_/);
    expect((await readHub(at.home)).assignments).toEqual([]);
    await confirmed(at, on.proposed ?? '');
    const claude = await readFile(join(at.home, '.claude.json'), 'utf8');
    expect(claude).toContain('memnox-secret:github-token');
    const off = await at.ask({
      method: DAEMON_METHOD.ASSIGN,
      mcpServerName: 'github',
      mcpAgent: CLAUDE,
      mcpOn: false,
    });
    expect(off.mcpSynced).toMatchObject({ removed: 1 });
    expect(off.mcpHub?.servers[0]?.agents).toEqual([]);
  });

  it('names the repository an agent was given a server in, and leaves an everywhere one unnamed', async () => {
    const at = await fixture();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-hub-project-'));
    await writeHub(at.home, {
      version: HUB_VERSION,
      servers: [GITHUB],
      assignments: [
        { server: 'github', agent: CLAUDE },
        { server: 'github', agent: CLAUDE, project: repo },
      ],
      written: [],
    });
    const answer = await at.ask({});
    expect(answer.mcpHub?.servers[0]?.projects).toEqual([
      { agent: CLAUDE, project: repo },
    ]);
    await writeHub(at.home, {
      version: HUB_VERSION,
      servers: [GITHUB],
      assignments: [{ server: 'github', agent: CLAUDE }],
      written: [],
    });
    expect((await at.ask({})).mcpHub?.servers[0]).not.toHaveProperty('projects');
  });

  it('keeps a secret typed at this computer, reports it held, and never returns its value', async () => {
    const at = await fixture();
    await confirmed(
      at,
      (await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB })).proposed ??
        '',
    );
    const fromPhone = await at.ask(
      {
        method: DAEMON_METHOD.SECRET_SET,
        mcpSecret: 'github-token',
        mcpSecretValue: TOKEN_VALUE,
      },
      true,
    );
    expect(fromPhone.ok).toBe(false);
    expect(await at.secrets.get('github-token')).toBeUndefined();
    const set = await at.ask({
      method: DAEMON_METHOD.SECRET_SET,
      mcpSecret: 'github-token',
      mcpSecretValue: TOKEN_VALUE,
    });
    expect(set.mcpHub?.servers[0]?.secretsHeld).toEqual({ 'github-token': true });
    expect(JSON.stringify(set)).not.toContain(TOKEN_VALUE);
    const test = await at.ask({ method: DAEMON_METHOD.TEST, mcpServerName: 'github' });
    expect(test.mcpHealth?.state).toBe(MCP_HEALTH.HEALTHY);
    expect(test.mcpHub?.servers[0]?.toolCount).toBe(1);
    expect(JSON.stringify(test)).not.toContain(TOKEN_VALUE);
    const removed = await at.ask({
      method: DAEMON_METHOD.SECRET_REMOVE,
      mcpSecret: 'github-token',
    });
    expect(removed.mcpHub?.servers[0]?.secretsHeld).toEqual({ 'github-token': false });
  });

  it('says a test failed when a secret the server needs is not held', async () => {
    const at = await fixture();
    await confirmed(
      at,
      (await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB })).proposed ??
        '',
    );
    const test = await at.ask({ method: DAEMON_METHOD.TEST, mcpServerName: 'github' });
    expect(test.mcpHealth).toMatchObject({
      state: MCP_HEALTH.ERROR,
      error: 'Not held yet: github-token.',
    });
  });

  it('imports a found server and removes a server unsigned', async () => {
    const at = await fixture();
    const imported = await at.ask({
      method: DAEMON_METHOD.IMPORT,
      mcpServerName: 'notes',
      mcpAgent: CLAUDE,
    });
    expect(imported.mcpHub?.found).toEqual([]);
    expect(imported.mcpHub?.servers.map((each) => each.agents)).toEqual([[CLAUDE]]);
    const removed = await at.ask({
      method: DAEMON_METHOD.SERVER_REMOVE,
      mcpServerName: 'notes',
    });
    expect(removed.mcpHub?.servers).toEqual([]);
    const claude = JSON.parse(await readFile(join(at.home, '.claude.json'), 'utf8'));
    expect(claude.mcpServers).toEqual({});
  });
  it('starts a server typed as a pip install with uvx, and says what will run', async () => {
    const at = await fixture();
    const typed: HubServer = {
      name: 'comfyui',
      transport: HUB_TRANSPORT.STDIO,
      command: 'pip',
      args: ['install', 'comfy-mcp'],
      env: {},
      secrets: {},
    };
    const put = await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: typed });
    expect(put.outcome).toBe(
      'pip install comfy-mcp only installs comfy-mcp, so the hub starts it with uvx comfy-mcp, which installs it the first time it starts.',
    );
    const proposal = await new Proposals(at.home).read(put.proposed ?? '');
    expect(proposal?.rationale).toBe(
      'Add the MCP server comfyui, started with uvx comfy-mcp',
    );
    expect(proposal?.change).toEqual({
      kind: PROPOSAL_KIND.MCP_HUB,
      hub: { put: { ...typed, command: 'uvx', args: ['comfy-mcp'] } },
    });
  });

  it('brings in a found line that is already the hub’s own for that agent, and refuses a different one', async () => {
    const at = await fixture();
    const put = await at.ask({ method: DAEMON_METHOD.SERVER_PUT, mcpServer: GITHUB });
    await confirmed(at, put.proposed ?? '');
    const desktop = join(
      at.home,
      'Library/Application Support/Claude/claude_desktop_config.json',
    );
    await mkdir(dirname(desktop), { recursive: true });
    await writeFile(
      desktop,
      JSON.stringify({ mcpServers: { github: entryFor(GITHUB, DESKTOP) } }),
    );
    const found = await at.ask({});
    expect(found.mcpHub?.found.map((each) => each.name)).toEqual(['notes', 'github']);
    const imported = await at.ask({
      method: DAEMON_METHOD.IMPORT,
      mcpServerName: 'github',
      mcpAgent: DESKTOP,
    });
    expect(imported.ok).toBe(true);
    expect(imported.mcpHub?.found.map((each) => each.name)).toEqual(['notes']);
    expect(imported.mcpHub?.servers[0]?.agents).toEqual([DESKTOP]);
    expect(imported.mcpHub?.skipped).toEqual([]);

    await writeFile(
      join(at.home, '.claude.json'),
      JSON.stringify({
        mcpServers: { github: { command: 'docker', args: ['run', 'gh'] } },
      }),
    );
    const different = await at.ask({
      method: DAEMON_METHOD.IMPORT,
      mcpServerName: 'github',
      mcpAgent: CLAUDE,
    });
    expect(different.ok).toBe(false);
    expect(different.error).toMatch(/different server named github/);
  });

  it('never offers or takes in Memnox’s own server, which carries this machine’s credential', async () => {
    const at = await fixture();
    await writeFile(
      join(at.home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          memnox: { type: 'http', url: 'https://api.memnox.com/v1/workspaces/w/mcp' },
        },
      }),
    );
    expect((await at.ask({})).mcpHub?.found).toEqual([]);
    const imported = await at.ask({
      method: DAEMON_METHOD.IMPORT,
      mcpServerName: 'memnox',
      mcpAgent: CLAUDE,
    });
    expect(imported.ok).toBe(false);
    expect((await readHub(at.home)).servers).toEqual([]);
  });
});
