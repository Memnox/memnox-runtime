import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLI_REMOVAL,
  MANAGED_REMOVAL,
  removeLocalClaudeHooks,
  removeManagedClaudeHook,
  removeOrphanWorkspaceServers,
  removeTheGlobalCli,
} from '../src/protect/uninstall-leftovers';

const OUR_HOOK = {
  type: 'command',
  command: '/Users/bo/.memnox/bin/memnox-edit-hook --agent claude-code',
};
const THEIR_HOOK = { type: 'command', command: 'say done' };

async function dir(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `memnox-${name}-`));
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function read(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('what memnox uninstall used to leave behind', () => {
  it('takes our hook out of the personal settings at home and in the repository, keeping theirs', async () => {
    const home = await dir('home');
    const repo = await dir('repo');
    const settings = {
      model: 'opus',
      hooks: { PreToolUse: [{ matcher: '*', hooks: [OUR_HOOK, THEIR_HOOK] }] },
    };
    await json(join(home, '.claude', 'settings.local.json'), settings);
    await json(join(repo, '.claude', 'settings.local.json'), settings);

    const removed = await removeLocalClaudeHooks(home, repo);

    expect(removed).toHaveLength(2);
    for (const path of removed) {
      expect(await read(path)).toEqual({
        model: 'opus',
        hooks: { PreToolUse: [{ matcher: '*', hooks: [THEIR_HOOK] }] },
      });
    }
  });

  it('writes nothing where no personal settings exist', async () => {
    const home = await dir('home');
    await mkdir(join(home, '.claude'));

    expect(await removeLocalClaudeHooks(home, home)).toEqual([]);
    expect(existsSync(join(home, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('takes our hook out of the managed settings it can write, and leaves a file without it alone', async () => {
    const root = await dir('managed');
    const managed = join(root, 'managed-settings.json');
    await json(managed, {
      allowManagedHooksOnly: true,
      hooks: { PreToolUse: [{ matcher: '*', hooks: [OUR_HOOK] }] },
    });

    expect(await removeManagedClaudeHook(managed)).toBe(MANAGED_REMOVAL.REMOVED);
    expect(await read(managed)).toEqual({ allowManagedHooksOnly: true });
    expect(await removeManagedClaudeHook(managed)).toBe(MANAGED_REMOVAL.NONE);
    expect(await removeManagedClaudeHook(null)).toBe(MANAGED_REMOVAL.NONE);
  });

  it('takes a lost workspace server out of each agent and keeps one the person named memnox for something else', async () => {
    const home = await dir('home');
    await json(join(home, '.cursor', 'mcp.json'), {
      mcpServers: {
        memnox: {
          type: 'http',
          url: 'https://api.memnox.com/mcp',
          headers: { Authorization: 'Bearer x' },
        },
        github: { command: 'gh-mcp' },
      },
    });
    await json(join(home, '.gemini', 'settings.json'), {
      mcpServers: { memnox: { command: 'my-own-notes-server' } },
    });
    await mkdir(join(home, '.codex'), { recursive: true });
    await writeFile(
      join(home, '.codex', 'config.toml'),
      'model = "o5"\n\n[mcp_servers.memnox]\nurl = "https://api.memnox.com/mcp"\n\n[mcp_servers.linear]\ncommand = "linear-mcp"\n',
    );

    const removed = await removeOrphanWorkspaceServers(home);

    expect(removed.sort()).toEqual(['Codex', 'Cursor']);
    expect(await read(join(home, '.cursor', 'mcp.json'))).toEqual({
      mcpServers: { github: { command: 'gh-mcp' } },
    });
    expect(await read(join(home, '.gemini', 'settings.json'))).toEqual({
      mcpServers: { memnox: { command: 'my-own-notes-server' } },
    });
    const codex = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(codex).not.toContain('[mcp_servers.memnox]');
    expect(codex).toContain('[mcp_servers.linear]');
    expect(codex).toContain('model = "o5"');
  });

  it.skipIf(process.platform === 'win32')(
    'takes an npm link and its bins away and leaves the checkout and every other bin',
    async () => {
      const home = await dir('home');
      const prefix = await dir('prefix');
      const checkout = await dir('checkout');
      await mkdir(join(checkout, 'dist'), { recursive: true });
      await writeFile(join(checkout, 'dist', 'index.js'), '');
      await mkdir(join(prefix, 'lib', 'node_modules'), { recursive: true });
      await mkdir(join(prefix, 'bin'));
      await symlink(checkout, join(prefix, 'lib', 'node_modules', 'memnox'));
      await symlink(
        join(prefix, 'lib', 'node_modules', 'memnox', 'dist', 'index.js'),
        join(prefix, 'bin', 'memnox'),
      );
      await writeFile(join(prefix, 'bin', 'other-tool'), '');

      const removed = await removeTheGlobalCli(home, {
        packageDir: checkout,
        prefixes: async () => [prefix],
        platform: 'darwin',
      });

      expect(removed.state).toBe(CLI_REMOVAL.UNLINKED);
      expect(existsSync(join(prefix, 'lib', 'node_modules', 'memnox'))).toBe(false);
      await expect(lstat(join(prefix, 'bin', 'memnox'))).rejects.toThrow();
      expect(existsSync(join(prefix, 'bin', 'other-tool'))).toBe(true);
      expect(existsSync(join(checkout, 'dist', 'index.js'))).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'removes a global install, and leaves the copy the Mac app keeps to go with the home',
    async () => {
      const home = await dir('home');
      const prefix = await dir('prefix');
      const installed = join(prefix, 'lib', 'node_modules', 'memnox');
      await mkdir(join(installed, 'dist'), { recursive: true });
      await writeFile(join(installed, 'dist', 'index.js'), '');
      await mkdir(join(prefix, 'bin'));
      await symlink(join(installed, 'dist', 'index.js'), join(prefix, 'bin', 'memnox'));

      const global = await removeTheGlobalCli(home, {
        packageDir: installed,
        prefixes: async () => [prefix],
        platform: 'darwin',
      });
      expect(global.state).toBe(CLI_REMOVAL.UNINSTALLED);
      expect(existsSync(installed)).toBe(false);

      const appCopy = join(home, '.memnox', 'node', 'lib', 'node_modules', 'memnox');
      await mkdir(appCopy, { recursive: true });
      const kept = await removeTheGlobalCli(home, {
        packageDir: appCopy,
        prefixes: async () => [prefix],
        platform: 'darwin',
      });
      expect(kept.state).toBe(CLI_REMOVAL.WITH_HOME);
      expect(existsSync(appCopy)).toBe(true);
    },
  );

  it('finds nothing where no prefix holds memnox', async () => {
    const home = await dir('home');
    const prefix = await dir('prefix');

    const removed = await removeTheGlobalCli(home, {
      packageDir: join(home, 'elsewhere'),
      prefixes: async () => [prefix],
      platform: 'darwin',
    });

    expect(removed.state).toBe(CLI_REMOVAL.NOT_FOUND);
  });
});
