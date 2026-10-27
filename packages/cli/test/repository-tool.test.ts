import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { repositoryTool } from '../src/session-tools/repository-tool';

const NOW = new Date('2026-10-19T12:00:00.000Z');

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-repository-'));
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

describe('a repository named that no session touched today', () => {
  it('is read from its folder rather than reported missing', async () => {
    const deps = await depsAt();
    const repo = join(deps.home, 'Documents', 'shop-api');
    await mkdir(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    await writeFile(join(repo, 'orders.ts'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'feat: take orders');

    const named = (await repositoryTool(deps, { repository: 'shop-api' })) as {
      repositories: { name: string; latestCommits: { subject: string }[] }[];
      said?: string;
    };
    expect(named.said).toBeUndefined();
    expect(named.repositories.map((each) => each.name)).toEqual(['shop-api']);
    expect(named.repositories[0]?.latestCommits[0]?.subject).toBe('feat: take orders');

    const byPath = (await repositoryTool(deps, { repository: repo })) as {
      repositories: { name: string }[];
    };
    expect(byPath.repositories.map((each) => each.name)).toEqual(['shop-api']);
  });

  it('still says none was found for a name nothing on the disk has', async () => {
    const deps = await depsAt();
    const answer = (await repositoryTool(deps, { repository: 'billing' })) as {
      repositories: unknown[];
      said?: string;
    };
    expect(answer.repositories).toEqual([]);
    expect(answer.said).toContain('No repository was found');
  });
});
