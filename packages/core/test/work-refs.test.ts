import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  currentBranch,
  describeTogether,
  workRefsAt,
  workRefsOfBranch,
} from '../src/index';

/* Ana's checkout is on `feature/ENG-45-checkout-page` and Andre's on `eng-46-checkout-api`.
   What each declares is read off the checkout, never guessed from what the agent says, so the
   workspace can find them on one epic. */

describe('what a branch declares about its feature', () => {
  it('names its ticket keys and itself', () => {
    expect(workRefsOfBranch('feature/ENG-45-checkout-page')).toEqual([
      'ticket:ENG-45',
      'branch:eng-45-checkout-page',
    ]);
    expect(workRefsOfBranch('ana/checkout-v2')).toEqual(['branch:checkout-v2']);
  });

  it('says nothing for a branch every repository has, or a word that is no ticket', () => {
    expect(workRefsOfBranch('main')).toEqual([]);
    expect(workRefsOfBranch(null)).toEqual([]);
    expect(workRefsOfBranch('release-2026')).toEqual(['branch:release-2026']);
    expect(workRefsOfBranch('fix/wip')).toEqual([]);
  });

  it('reads the branch from a clone and from a worktree', async () => {
    const clone = await mkdtemp(join(tmpdir(), 'memnox-refs-'));
    await mkdir(join(clone, '.git'));
    await writeFile(join(clone, '.git', 'HEAD'), 'ref: refs/heads/eng-46-checkout-api\n');
    expect(await currentBranch(clone)).toBe('eng-46-checkout-api');
    expect(await workRefsAt(clone)).toEqual([
      'ticket:ENG-46',
      'branch:eng-46-checkout-api',
    ]);

    const worktree = await mkdtemp(join(tmpdir(), 'memnox-refs-'));
    const gitDir = join(clone, '.git', 'worktrees', 'page');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/feature/ENG-45-page\n');
    await writeFile(join(worktree, '.git'), `gitdir: ${gitDir}\n`);
    expect(await currentBranch(worktree)).toBe('feature/ENG-45-page');
  });

  it('reads nothing where there is no repository, and nothing for a detached head', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'memnox-refs-'));
    expect(await currentBranch(plain)).toBeNull();
    await mkdir(join(plain, '.git'));
    await writeFile(
      join(plain, '.git', 'HEAD'),
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n',
    );
    expect(await currentBranch(plain)).toBeNull();
  });
});

describe('the notice that two people are working together', () => {
  const data = {
    featureName: 'ENG-40',
    members: [
      { agent: 'claude-code', ownerName: 'Ana', ownerPersonId: 'usr_ana' },
      {
        agent: 'codex',
        ownerName: 'Andre',
        ownerPersonId: 'usr_andre',
        doing: 'writing createCheckout in api/src/checkout/routes.ts',
      },
    ],
  };

  it('names the others and what their agents are doing, and says nobody is needed', () => {
    expect(describeTogether(data, 'usr_ana')).toBe(
      "Andre's codex, writing createCheckout in api/src/checkout/routes.ts: working on ENG-40 with your claude-code. They are talking to each other directly and will bring you in if they need you.",
    );
  });

  it('says nothing to somebody with nobody else on it', () => {
    expect(
      describeTogether({ featureName: 'ENG-40', members: [] }, 'usr_ana'),
    ).toBeNull();
  });
});
