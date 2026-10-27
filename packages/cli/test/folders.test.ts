import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMNOX_HOME } from '@memnox/core';
import { foldersContext } from '../src/daemon/ask-context';
import {
  folderUses,
  homeFolders,
  nameMatch,
  noteFolderUse,
} from '../src/operator/folders';
import { foldersTool, openFolderTool } from '../src/session-tools/folder-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

const NOW = new Date('2026-10-04T08:00:00.000Z');

async function homeWith(paths: readonly string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'folders-'));
  for (const path of paths) await mkdir(join(home, path), { recursive: true });
  return home;
}

// Only what the folder tools read is given.
const depsOf = (home: string): SessionToolDeps =>
  ({ home, now: () => NOW }) as SessionToolDeps;

describe('the folders in a home', () => {
  it('lists the places to open, never the system, build output or the inside of a repository', async () => {
    const home = await homeWith([
      'Documents/Memnox-saas/memnox-macos/.git',
      'Documents/Memnox-saas/memnox-macos/Sources',
      'Documents/shop/node_modules/react',
      'Library/Caches',
      '.config',
    ]);
    const names = (await homeFolders(home, 0)).map((each) => each.name);
    expect(names).toEqual(
      expect.arrayContaining(['Documents', 'Memnox-saas', 'memnox-macos', 'shop']),
    );
    for (const hidden of ['Sources', 'node_modules', 'Library', '.config'])
      expect(names).not.toContain(hidden);
  });

  it('finds one by its name as it was said, even misheard', () => {
    const folder = {
      name: 'memnox-macos',
      path: '/Users/a/Documents/Memnox-saas/memnox-macos',
    };
    expect(nameMatch('memnox macos', folder, '/Users/a')).toBe(1);
    expect(nameMatch('mem nox mac OS folder', folder, '/Users/a')).toBe(1);
    expect(nameMatch('memnocks macos', folder, '/Users/a')).toBeGreaterThan(0.5);
    expect(nameMatch('invoices', folder, '/Users/a')).toBe(0);
  });

  it('ranks the folders opened most and lately first, and puts them before what is said', async () => {
    const home = await homeWith(['work/api', 'work/web']);
    await noteFolderUse(home, join(home, 'work/web'), NOW.toISOString());
    await noteFolderUse(home, join(home, 'work/api'), '2025-01-01T00:00:00.000Z');
    await noteFolderUse(home, join(home, 'work/api'), '2025-01-01T00:00:00.000Z');
    const uses = await folderUses(home, NOW.getTime());
    expect(uses.map((each) => each.path)).toEqual([
      join(home, 'work/web'),
      join(home, 'work/api'),
    ]);
    expect(foldersContext(uses)).toContain(`"${join(home, 'work/web')}" (1 uses)`);
    expect(foldersContext([])).toBe('');
  });

  it('finds and opens one, noting it as used', async () => {
    const home = await homeWith([
      'Documents/Memnox-saas/memnox-runtime',
      'Documents/runtime-notes',
    ]);
    const found = (await foldersTool(depsOf(home), { name: 'memnox runtime' })) as {
      matches: { path: string }[];
    };
    const path = join(home, 'Documents/Memnox-saas/memnox-runtime');
    expect(found.matches[0]?.path).toBe(path);
    expect(await openFolderTool(depsOf(home), { path, in: 'editor' })).toEqual({
      opened: true,
      path,
      in: 'editor',
    });
    expect(await readdir(join(home, MEMNOX_HOME, 'displays'))).toHaveLength(1);
    expect((await folderUses(home, NOW.getTime()))[0]?.path).toBe(path);
  });

  it('opens nothing that is not a folder there', async () => {
    const home = await homeWith([]);
    expect(await openFolderTool(depsOf(home), { path: '~/nowhere' })).toMatchObject({
      opened: false,
    });
  });
});
