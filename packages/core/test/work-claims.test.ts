import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloudLeases } from '../src/coordination/shared-leases';
import {
  commitClaimsAt,
  keysInText,
  numberClaimOfBranch,
  workClaimsAt,
} from '../src/coordination/work-claims';
import type { LeaseHolder } from '../src/coordination/lease';

/**
 * What a checkout claims: an issue number at the head of its branch and the
 * keys its head commit names, read off the checkout and sent as claims, never
 * as the words they were read out of.
 */

const holder: LeaseHolder = { agent: 'claude-code', sessionId: 'ses_a', pid: 1 };

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'A',
      GIT_AUTHOR_EMAIL: 'a@example.test',
      GIT_COMMITTER_NAME: 'A',
      GIT_COMMITTER_EMAIL: 'a@example.test',
    },
  });
}

async function repository(branch: string, message: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memnox-claims-'));
  git(root, 'init', '-q', '-b', branch);
  await writeFile(join(root, 'a.txt'), 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', message);
  return root;
}

describe('the number a branch was made for', () => {
  it('reads the forms a forge writes', () => {
    expect(numberClaimOfBranch('12-fix-login')?.value).toBe('#12');
    expect(numberClaimOfBranch('moise/issue-7-retry')?.value).toBe('#7');
    expect(numberClaimOfBranch('gh-31')?.value).toBe('#31');
  });

  it('reads no year, no bare number and no number buried in a word', () => {
    expect(numberClaimOfBranch('2026-planning')).toBeUndefined();
    expect(numberClaimOfBranch('12')).toBeUndefined();
    expect(numberClaimOfBranch('v12-release')).toBeUndefined();
    expect(numberClaimOfBranch('main')).toBeUndefined();
    expect(numberClaimOfBranch(null)).toBeUndefined();
  });
});

describe('the keys a commit names', () => {
  it('reads keys written as a tracker writes them', () => {
    expect(keysInText('PAY-42: retry failed payments\n\nRefs ENG-7')).toEqual([
      'PAY-42',
      'ENG-7',
    ]);
  });

  it('reads no standard, no version and no lowercase word', () => {
    expect(keysInText('Use UTF-8 and SHA-256 per RFC-7231, fix cve-12 and x-1')).toEqual(
      [],
    );
  });

  it('reads a long list as a list rather than the work', () => {
    expect(keysInText('Merged PAY-1, PAY-2, PAY-3 and PAY-4')).toEqual([]);
  });
});

describe('what a checkout claims', () => {
  it('names its branch, its number and its head commit keys with the commit', async () => {
    const root = await repository('moise/12-retry', 'PAY-42 retry payments');

    const claimed = await workClaimsAt(root);

    expect(claimed.branch).toBe('moise/12-retry');
    expect(claimed.claims.map((each) => [each.source, each.value])).toEqual([
      ['branch', '#12'],
      ['commit', 'PAY-42'],
    ]);
    expect(claimed.claims[1]?.evidence).toMatch(/^[0-9a-f]{40}$/);
  });

  it('claims nothing where there is no repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memnox-none-'));
    expect(await commitClaimsAt(root)).toEqual([]);
    expect(await workClaimsAt(root)).toEqual({ claims: [] });
  });

  it('sends the branch and its claims beside the lease, and nothing of the message', async () => {
    const root = await repository('feat/pay-7', 'PAY-42 the secret plan for the launch');
    const bodies: Record<string, unknown>[] = [];
    const home = await mkdtemp(join(tmpdir(), 'memnox-home-'));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(home, '.memnox'), { recursive: true });
    await writeFile(
      join(home, '.memnox', 'account.json'),
      JSON.stringify({
        version: 1,
        baseUrl: 'https://control.example.com',
        workspaceId: 'acme',
        machineId: 'mch_1',
        token: 't',
        privateKey: 'pem',
        enrolledAt: '2026-09-05T10:00:00.000Z',
      }),
    );
    const fetcher = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'lse_1' }), { status: 201 });
    }) as unknown as typeof globalThis.fetch;

    await new CloudLeases(home, fetcher, 1_000, 'github.com/acme/api', undefined, () =>
      workClaimsAt(root),
    ).take('a.txt', holder, 30);

    expect(bodies[0]?.['branch']).toBe('feat/pay-7');
    expect(bodies[0]?.['claims']).toEqual([
      expect.objectContaining({ value: 'PAY-42', source: 'commit' }),
    ]);
    expect(JSON.stringify(bodies[0])).not.toContain('secret plan');
  });

  it('reads nothing at all for a machine with no account', async () => {
    let asked = false;
    const home = await mkdtemp(join(tmpdir(), 'memnox-alone-'));
    const outcome = await new CloudLeases(
      home,
      globalThis.fetch,
      1_000,
      undefined,
      undefined,
      async () => {
        asked = true;
        return { claims: [] };
      },
    ).take('a.txt', holder, 30);

    expect(outcome.outcome).toBe('unknown');
    expect(asked).toBe(false);
  });
});
