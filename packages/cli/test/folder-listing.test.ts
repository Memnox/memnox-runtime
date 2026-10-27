import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  REMOTE_OUTCOME,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { filesListAnswer, MOST_FILES_LISTED } from '../src/daemon/folder-listing';

/**
 * A phone browsing the Mac's folders: names, kinds, sizes and dates under the home, folders first,
 * and a plain refusal for anything outside it, hidden, or where credentials sit.
 */

async function homeWithFiles(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-files-'));
  await mkdir(join(home, 'Documents', 'Taxes'), { recursive: true });
  await mkdir(join(home, 'Desktop'));
  await mkdir(join(home, '.ssh'));
  await writeFile(join(home, '.ssh', 'id_ed25519'), 'secret');
  await writeFile(join(home, '.zshrc'), 'export A=1');
  await writeFile(join(home, 'notes.txt'), 'hello');
  await writeFile(join(home, 'Budget.xlsx'), 'x'.repeat(12));
  await writeFile(join(home, 'Documents', 'report 10.pdf'), 'pdf');
  await writeFile(join(home, 'Documents', 'report 9.pdf'), 'pdf');
  return home;
}

function list(home: string, path?: string): Promise<DaemonResponse> {
  const request: DaemonRequest = {
    id: 1,
    method: DAEMON_METHOD.FILES_LIST,
    ...(path === undefined ? {} : { path }),
  };
  return filesListAnswer(home, request);
}

function names(response: DaemonResponse): string[] {
  return (response.files ?? []).map((each) => each.name);
}

function expectRefused(response: DaemonResponse): void {
  expect(response).toMatchObject({ ok: false, outcome: REMOTE_OUTCOME.REFUSED });
  expect(response.reason).toEqual(expect.any(String));
  expect(response.files).toBeUndefined();
}

describe('listing a folder for a phone', () => {
  it('lists the home with no path, as an empty path, folders first then by name', async () => {
    const home = await homeWithFiles();
    const listed = await list(home);

    expect(listed.ok).toBe(true);
    expect(listed.path).toBe('');
    expect(names(listed)).toEqual(['Desktop', 'Documents', 'Budget.xlsx', 'notes.txt']);
    expect(listed.files?.[0]).toEqual({
      name: 'Desktop',
      kind: 'folder',
      modified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(listed.files?.find((each) => each.name === 'Budget.xlsx')).toMatchObject({
      kind: 'file',
      bytes: 12,
    });
  });

  it('lists a subfolder by its path under the home, numbers read as numbers', async () => {
    const home = await homeWithFiles();
    const listed = await list(home, 'Documents');

    expect(listed.path).toBe('Documents');
    expect(names(listed)).toEqual(['Taxes', 'report 9.pdf', 'report 10.pdf']);
  });

  it('leaves hidden entries out of every listing', async () => {
    const home = await homeWithFiles();
    expect(names(await list(home))).not.toContain('.ssh');
    expect(names(await list(home))).not.toContain('.zshrc');
  });

  it('refuses a path that climbs out of the home', async () => {
    const home = await homeWithFiles();
    expectRefused(await list(home, '..'));
    expectRefused(await list(home, 'Documents/../../'));
    expectRefused(await list(home, '/etc'));
  });

  it('refuses a link inside the home that leads out of it', async () => {
    const home = await homeWithFiles();
    const outside = await mkdtemp(join(tmpdir(), 'memnox-outside-'));
    await symlink(outside, join(home, 'Elsewhere'));
    expectRefused(await list(home, 'Elsewhere'));
  });

  it('refuses a folder where credentials sit, named or reached through a link', async () => {
    const home = await homeWithFiles();
    await mkdir(join(home, 'Library', 'Keychains'), { recursive: true });
    await symlink(join(home, '.ssh'), join(home, 'keys'));

    expectRefused(await list(home, '.ssh'));
    expectRefused(await list(home, 'keys'));
    expectRefused(await list(home, 'Library/Keychains'));
    expect((await list(home, 'Library')).ok).toBe(true);
  });

  it('refuses a file and a folder that is not there, in a plain line', async () => {
    const home = await homeWithFiles();
    expectRefused(await list(home, 'notes.txt'));
    expectRefused(await list(home, 'Nowhere'));
  });

  it('stops at the most it lists, keeping folders ahead of files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-files-many-'));
    await mkdir(join(home, 'zz folder'));
    await Promise.all(
      Array.from({ length: MOST_FILES_LISTED + 20 }, (_, index) =>
        writeFile(join(home, `file ${index}.txt`), ''),
      ),
    );
    const listed = await list(home);

    expect(listed.files).toHaveLength(MOST_FILES_LISTED);
    expect(listed.files?.[0]?.name).toBe('zz folder');
  });
});
