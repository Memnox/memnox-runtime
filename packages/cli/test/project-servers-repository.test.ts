import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  writeHub,
  type DiscoveredAgentKind,
  type Hub,
  type HubServer,
} from '@memnox/core';
import { applyHubProposal } from '../src/daemon/mcp-hub-confirm';
import { syncHub } from '../src/mcp/hub-writer';
import { EXCLUDE_BEGIN, EXCLUDE_END, splitBlock } from '../src/mcp/repo-exclude';

/**
 * A project's servers never dirty its checkout: a config file the repository tracks is left
 * alone and said so, and one Memnox writes is named in `.git/info/exclude`, never `.gitignore`.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const CURSOR = DISCOVERED_AGENT_KIND.CURSOR;
const VS_CODE = DISCOVERED_AGENT_KIND.VS_CODE;

const LINEAR: HubServer = {
  name: 'linear',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: {},
  secrets: {},
};

const TEAM_SERVER = { command: 'node', args: ['team.js'] };
const CURSOR_FILE = join('.cursor', 'mcp.json');
const VS_CODE_FILE = join('.vscode', 'mcp.json');

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** A machine with Claude Code installed and a repository holding a team Cursor config. */
async function machine(): Promise<{ home: string; root: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-repo-servers-'));
  const root = await mkdtemp(join(tmpdir(), 'memnox-repo-servers-repo-'));
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  git(root, 'init', '-q');
  await mkdir(join(root, '.cursor'), { recursive: true });
  await writeFile(
    join(root, CURSOR_FILE),
    JSON.stringify({ mcpServers: { team: TEAM_SERVER } }),
  );
  return { home, root };
}

function givenIn(root: string, agents: readonly DiscoveredAgentKind[]): Hub {
  let hub = withServer(emptyHub(), LINEAR);
  for (const agent of agents)
    hub = withAssignment(hub, { server: 'linear', agent, project: root }, true);
  return hub;
}

async function excluded(root: string): Promise<string[]> {
  const path = join(root, '.git', 'info', 'exclude');
  return existsSync(path) ? splitBlock(await readFile(path, 'utf8')).entries : [];
}

describe('a project server and a config file the repository tracks', () => {
  it('leaves the file alone, says so, and still gives Claude Code its local scope', async () => {
    const { home, root } = await machine();
    git(root, 'add', CURSOR_FILE);
    const before = await readFile(join(root, CURSOR_FILE), 'utf8');

    const synced = await syncHub(home, givenIn(root, [CLAUDE, CURSOR]));

    expect(await readFile(join(root, CURSOR_FILE), 'utf8')).toBe(before);
    expect(synced.left).toEqual([
      expect.stringContaining(
        'Cursor reads the servers of memnox-repo-servers-repo-',
      ) as unknown as string,
    ]);
    expect(synced.left[0]).toContain(
      'from .cursor/mcp.json, which the repository tracks, so Memnox left it alone.',
    );
    expect(await readFile(join(home, '.claude.json'), 'utf8')).toContain(HUB_MARKER);
    expect(await excluded(root)).toEqual([]);
  });

  it('says so in the outcome of the signed proposal that gave it', async () => {
    const { home, root } = await machine();
    git(root, 'add', CURSOR_FILE);
    await writeHub(home, withServer(emptyHub(), LINEAR));

    const applied = await applyHubProposal(home, {
      assign: { server: 'linear', agent: CURSOR, project: root },
    });
    expect(applied).toEqual({
      ok: true,
      outcome: expect.stringContaining(
        'which the repository tracks, so Memnox left it alone.',
      ) as unknown as string,
    });
  });
});

describe('a project server and a config file the repository does not track', () => {
  it('writes an untracked file and names it once in the exclude block, never .gitignore', async () => {
    const { home, root } = await machine();
    await syncHub(home, givenIn(root, [CURSOR]));
    await syncHub(home, givenIn(root, [CURSOR]));

    expect(await readFile(join(root, CURSOR_FILE), 'utf8')).toContain(HUB_MARKER);
    expect(await excluded(root)).toEqual(['/.cursor/mcp.json']);
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('creates an absent file, and keeps what the person had in the exclude file', async () => {
    const { home, root } = await machine();
    const exclude = join(root, '.git', 'info', 'exclude');
    await writeFile(exclude, '# my own\n*.log\n');
    await syncHub(home, givenIn(root, [VS_CODE]));

    expect(await readFile(join(root, VS_CODE_FILE), 'utf8')).toContain(HUB_MARKER);
    const raw = await readFile(exclude, 'utf8');
    expect(raw.startsWith('# my own\n*.log\n')).toBe(true);
    expect(raw).toContain(`${EXCLUDE_BEGIN}\n/.vscode/mcp.json\n${EXCLUDE_END}\n`);
  });
});

describe('a project server taken back out', () => {
  it('removes a file Memnox made with its entry, and gives the person theirs back', async () => {
    const { home, root } = await machine();
    const exclude = join(root, '.git', 'info', 'exclude');
    await writeFile(exclude, '*.log\n');
    const given = await syncHub(home, givenIn(root, [CURSOR, VS_CODE]));
    expect(await excluded(root)).toHaveLength(2);

    const taken = given.hub.assignments.reduce(
      (hub, each) => withAssignment(hub, each, false),
      given.hub,
    );
    await syncHub(home, taken);

    expect(existsSync(join(root, VS_CODE_FILE))).toBe(false);
    expect(existsSync(join(root, '.vscode'))).toBe(false);
    const cursor = JSON.parse(await readFile(join(root, CURSOR_FILE), 'utf8')) as {
      mcpServers: unknown;
    };
    expect(cursor.mcpServers).toEqual({ team: TEAM_SERVER });
    expect(await readFile(exclude, 'utf8')).toBe('*.log\n');
  });

  it('drops the entry of a file the person removed', async () => {
    const { home, root } = await machine();
    const given = await syncHub(home, givenIn(root, [VS_CODE]));
    expect(await excluded(root)).toEqual(['/.vscode/mcp.json']);
    await rm(join(root, '.vscode'), { recursive: true });

    await syncHub(home, given.hub);
    expect(await excluded(root)).toEqual([]);
  });
});
