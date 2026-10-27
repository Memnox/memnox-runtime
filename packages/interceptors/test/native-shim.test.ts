import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  installInterceptors,
  nativeInterceptorUnder,
  NATIVE_INTERCEPT_BINARY,
  removeInterceptors,
} from '../src/index';

async function fake(path: string, says: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\necho "${says} $*"\n`);
  await chmod(path, 0o755);
}

/** A machine with a real git, a Node interceptor and a native one under an awkward path. */
async function machine(): Promise<{ home: string; real: string; native: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-native-'));
  const real = join(home, 'real-bin');
  await mkdir(real, { recursive: true });
  await fake(join(real, 'git'), 'real git');
  await fake(join(real, 'memnox-intercept'), 'node');
  const shipped = join(home, "it's a $HOME");
  const native = nativeInterceptorUnder(shipped, 'darwin', 'arm64');
  await mkdir(join(native, '..'), { recursive: true });
  await fake(native, 'native');
  return { home, real, native };
}

function typed(shims: string, real: string): string {
  return spawnSync('git', ['status'], {
    env: { PATH: `${shims}:${real}:/usr/bin:/bin` },
    encoding: 'utf8',
  }).stdout.trim();
}

describe('the shims with a native wrapper in front', () => {
  it('runs the native wrapper first, quoted, and Node where it is gone', async () => {
    const { home, real, native } = await machine();
    const report = await installInterceptors(home, 'memnox-intercept', {
      path: real,
      native,
      platform: 'darwin',
    });
    expect(report.installed).toContain('git');
    expect(typed(report.directory, real)).toBe('native git status');

    await chmod(native, 0o644);
    expect(typed(report.directory, real)).toBe('node git status');
  });

  it('writes the shims it always wrote when no native wrapper was built', async () => {
    const { home, real } = await machine();
    const report = await installInterceptors(home, 'memnox-intercept', { path: real });
    const script = await readFile(join(report.directory, 'git'), 'utf8');
    expect(script).not.toContain(NATIVE_INTERCEPT_BINARY);
    expect(typed(report.directory, real)).toBe('node git status');
  });

  it('leaves nothing behind on removal, since the native wrapper is never copied', async () => {
    const { home, real, native } = await machine();
    await installInterceptors(home, 'memnox-intercept', { path: real, native });
    const removed = await removeInterceptors(home);
    expect(removed).not.toContain(NATIVE_INTERCEPT_BINARY);
    expect(spawnSync('test', ['-x', native]).status).toBe(0);
  });
});
