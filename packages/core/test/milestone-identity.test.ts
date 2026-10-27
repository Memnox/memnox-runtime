import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Milestones } from '../src/recovery/milestones';
import { NodeGit, NodeWorktree } from '../src/recovery/node-git';

// No config file of any kind, and no guessing a name from the machine: a CI runner, or a
// laptop where git was never set up, which is where `commit-tree` refused every milestone.
const NO_IDENTITY: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'user.useConfigOnly',
  GIT_CONFIG_VALUE_0: 'true',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('a milestone on a machine where git has no identity', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(NO_IDENTITY)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is still taken, and signed as Memnox rather than as the person', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memnox-identity-'));
    git(root, 'init', '-q');
    await writeFile(join(root, 'a.txt'), 'first\n');
    git(root, 'add', '.');
    git(
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-qm',
      'start',
    );
    await writeFile(join(root, 'a.txt'), 'second\n');

    const taken = await new Milestones(new NodeGit(root), new NodeWorktree(root)).take({
      at: '2026-10-15T10:00:00.000Z',
    });

    expect(git(root, 'log', '-1', '--format=%an <%ae>', taken.commit)).toBe(
      'Memnox <milestone@memnox.invalid>',
    );
  });
});
