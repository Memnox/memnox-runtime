import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  markdownMarked,
  NATIVE_PLACED,
  placeNativeFile,
  placeNativeFolder,
  removeNativeFile,
  removeNativeFolder,
  tomlMarked,
} from '../src/distribute/native-files';

// Every file Memnox writes into an agent's own format is marked, never written over a person's
// file, and only taken out when it is ours.

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-native-files-'));
}

describe('a native file', () => {
  it('is written with its marker, left alone when unchanged, and removed when ours', async () => {
    const dir = await scratch();
    const path = join(dir, '.claude', 'commands', 'deploy.md');
    const text = markdownMarked('# Deploy');

    expect(await placeNativeFile({ path, content: text })).toBe(NATIVE_PLACED.WRITTEN);
    expect(await placeNativeFile({ path, content: text })).toBe(NATIVE_PLACED.UNCHANGED);
    expect(await readFile(path, 'utf8')).toBe(text);
    expect(await removeNativeFile(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('never overwrites or removes a file a person wrote under the same name', async () => {
    const dir = await scratch();
    const path = join(dir, 'deploy.toml');
    await writeFile(path, 'prompt = "mine"\n');

    expect(
      await placeNativeFile({ path, content: tomlMarked('prompt = "ours"\n') }),
    ).toBe(NATIVE_PLACED.KEPT);
    expect(await removeNativeFile(path)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('prompt = "mine"\n');
  });

  it('refuses text with no marker, since it could never be taken out again', async () => {
    const dir = await scratch();
    await expect(
      placeNativeFile({ path: join(dir, 'x.md'), content: 'no marker' }),
    ).rejects.toThrow(/marker/);
  });
});

describe('a native folder', () => {
  it('is written whole, drops a file it no longer holds, and leaves a person file on removal', async () => {
    const dir = join(await scratch(), 'skills', 'deploy');
    const marker = markdownMarked('# Deploy');
    const first = {
      dir,
      markerFile: 'SKILL.md',
      files: [
        { relative: 'SKILL.md', content: marker },
        { relative: 'scripts/run.sh', content: new Uint8Array([35, 33]) },
      ],
    };
    expect(await placeNativeFolder(first)).toBe(NATIVE_PLACED.WRITTEN);
    expect(await placeNativeFolder(first)).toBe(NATIVE_PLACED.UNCHANGED);

    const second = { ...first, files: [{ relative: 'SKILL.md', content: marker }] };
    expect(
      await placeNativeFolder(second, { previous: ['SKILL.md', 'scripts/run.sh'] }),
    ).toBe(NATIVE_PLACED.WRITTEN);
    expect(existsSync(join(dir, 'scripts', 'run.sh'))).toBe(false);

    await writeFile(join(dir, 'notes.md'), 'mine');
    expect(
      await removeNativeFolder({ dir, markerFile: 'SKILL.md', files: ['SKILL.md'] }),
    ).toBe(true);
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false);
    expect(await readFile(join(dir, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('leaves a folder a person made, marker file or not', async () => {
    const dir = join(await scratch(), 'deploy');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.md'), 'mine');
    const folder = {
      dir,
      markerFile: 'SKILL.md',
      files: [{ relative: 'SKILL.md', content: markdownMarked('# Deploy') }],
    };

    expect(await placeNativeFolder(folder)).toBe(NATIVE_PLACED.KEPT);
    await writeFile(join(dir, 'SKILL.md'), '# Mine');
    expect(await placeNativeFolder(folder)).toBe(NATIVE_PLACED.KEPT);
    expect(await removeNativeFolder({ dir, markerFile: 'SKILL.md', files: [] })).toBe(
      false,
    );
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('# Mine');
  });
});
