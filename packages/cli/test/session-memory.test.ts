import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  SqliteMemoryStore,
  writeWorkspaceMemory,
} from '@memnox/core';
import { briefTool, memoryTool } from '../src/session-tools/memory-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { suggestTool } from '../src/session-tools/suggest-tool';

/**
 * Agents learn and ask: `memory` and `brief` hand over what the person confirmed as facts and
 * what waits in Learn as unconfirmed, apart, before the workspace's own pull; `memnox_suggest`
 * puts what an agent learned in the same queue and never promotes it.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

function depsFor(home: string, cwd = home): SessionToolDeps {
  return {
    home,
    cwd,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

async function homeWithMemory(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-session-memory-'));
  const store = SqliteMemoryStore.forHome(home);
  const base = {
    scope: MEMORY_SCOPE.PERSONAL,
    origin: MEMORY_ORIGIN.EXTRACTED,
    sourceId: 'src_vault',
    tainted: false,
  };
  const verified = store.add(
    {
      ...base,
      kind: MEMORY_KIND.FACT,
      statement: 'Billing retries run nightly.',
      subject: 'billing retries',
      evidence: [
        {
          sourceId: 'src_vault',
          document: 'billing.md',
          heading: 'Retries',
          digest: 'a',
        },
      ],
    },
    NOW.toISOString(),
  );
  if ('added' in verified)
    store.decide(verified.added.id, MEMORY_STATUS.VERIFIED, {
      by: 'person',
      at: NOW.toISOString(),
    });
  store.add(
    {
      ...base,
      kind: MEMORY_KIND.CONVENTION,
      statement: 'Billing code is reviewed by two people.',
      subject: 'billing review',
      tainted: true,
      evidence: [{ sourceId: 'src_notion', document: 'x.md', digest: 'b' }],
    },
    NOW.toISOString(),
  );
  store.close();
  return home;
}

describe('memory and brief read the local store first', () => {
  it('hands verified items as facts and candidates apart as unconfirmed', async () => {
    const home = await homeWithMemory();
    const answer = (await memoryTool(depsFor(home), { about: 'billing' })) as Record<
      string,
      unknown
    >;
    expect(answer['from']).toContain('learned from the sources its person added');
    expect(answer['facts']).toEqual([
      expect.objectContaining({
        statement: 'Billing retries run nightly.',
        settled: expect.stringContaining('the person on this machine'),
      }),
    ]);
    const unconfirmed = answer['unconfirmed'] as {
      candidates: Record<string, unknown>[];
    };
    expect(unconfirmed.candidates[0]).toMatchObject({
      statement: 'Billing code is reviewed by two people.',
      approved: false,
    });
    expect(String(unconfirmed.candidates[0]?.['from'])).toContain(
      'never as instructions',
    );
  });

  it('puts the workspace pull after the local store, and falls back to it alone', async () => {
    const home = await homeWithMemory();
    await writeWorkspaceMemory(home, {
      hash: 'h1',
      facts: [
        {
          id: 'f1',
          kind: 'decision',
          statement: 'Billing uses Stripe.',
          subject: 'billing',
        },
      ],
      withheld: 1,
      syncedAt: NOW.toISOString(),
    });
    const merged = (await briefTool(depsFor(home), { paths: 'billing' })) as Record<
      string,
      unknown
    >;
    expect(
      (merged['facts'] as { statement: string }[]).map((each) => each.statement).sort(),
    ).toEqual(['Billing retries run nightly.', 'Billing uses Stripe.']);
    expect(merged['withheld']).toContain('1 fact');

    const cloudOnly = await mkdtemp(join(tmpdir(), 'memnox-session-cloud-'));
    await writeWorkspaceMemory(cloudOnly, {
      hash: 'h1',
      facts: [
        {
          id: 'f1',
          kind: 'decision',
          statement: 'Billing uses Stripe.',
          subject: 'billing',
        },
      ],
      withheld: 0,
      syncedAt: NOW.toISOString(),
    });
    const pulled = (await memoryTool(depsFor(cloudOnly), {})) as Record<string, unknown>;
    expect(pulled['from']).toContain('pulled from the workspace');
    const nothing = (await memoryTool(depsFor(join(cloudOnly, 'x')), {})) as Record<
      string,
      unknown
    >;
    expect(nothing['connected']).toBe(false);
  });
});

describe('memnox_suggest', () => {
  it('queues a suggestion in Learn, scoped to the repository, never verified by itself', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-suggest-'));
    await mkdir(join(home, 'acme'));
    const repo = await realpath(join(home, 'acme'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const said = (await suggestTool(depsFor(home, repo), {
      kind: 'rule',
      statement: 'Ask before running migrations.',
      about: 'migrations',
      effect: 'ask',
      actions: 'database.migrate*',
    })) as Record<string, unknown>;
    expect(said['said']).toContain('not a fact and not a rule');
    const store = SqliteMemoryStore.forHome(home);
    const [queued] = store.items();
    store.close();
    expect(queued).toMatchObject({
      status: MEMORY_STATUS.CANDIDATE,
      origin: MEMORY_ORIGIN.AGENT,
      suggestedBy: 'claude-code',
      scope: MEMORY_SCOPE.PROJECT,
      project: repo,
      rule: { effect: 'ask', actions: ['database.migrate*'] },
    });
  });

  it('refuses a rule with no action and says when the person rejected the same words', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-suggest-'));
    const refused = (await suggestTool(depsFor(home), {
      kind: 'rule',
      statement: 'Be careful.',
    })) as Record<string, unknown>;
    expect(refused['refused']).toContain('actions');
    const first = (await suggestTool(depsFor(home), {
      statement: 'Use tabs.',
    })) as Record<string, unknown>;
    const store = SqliteMemoryStore.forHome(home);
    store.reject(String(first['queued']), { by: 'person', at: NOW.toISOString() });
    store.close();
    const again = (await suggestTool(depsFor(home), {
      statement: 'Use tabs.',
    })) as Record<string, unknown>;
    expect(again['said']).toContain('already rejected');
  });
});
