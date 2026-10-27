import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectIdentityOf } from '../src/git-branch';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** A repository with one commit, and a second worktree of it beside it. */
async function repositoryWithWorktree(): Promise<{ main: string; worktree: string }> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'memnox-project-')));
  const main = join(parent, 'api');
  git(parent, 'init', '-q', main);
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'test');
  git(main, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(main, 'a.txt'), 'first\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  const worktree = join(parent, 'api-feature');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  return { main, worktree };
}

describe('what every checkout of one repository shares', () => {
  it('is one identity for a repository and its worktree, with no remote to name it', async () => {
    const { main, worktree } = await repositoryWithWorktree();

    const fromMain = projectIdentityOf(main);
    expect(fromMain).toBeDefined();
    expect(projectIdentityOf(worktree)).toBe(fromMain);
  });

  it('is the remote where there is one, so it matches what the workspace register keys on', async () => {
    const { main, worktree } = await repositoryWithWorktree();
    git(main, 'remote', 'add', 'origin', 'git@github.com:Acme/API.git');

    expect(projectIdentityOf(main)).toBe('github.com/acme/api');
    expect(projectIdentityOf(worktree)).toBe('github.com/acme/api');
  });

  it('is undefined outside a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memnox-project-none-'));
    expect(projectIdentityOf(outside)).toBeUndefined();
  });
});
