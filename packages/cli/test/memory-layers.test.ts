import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  MEMORY_INDEX_MARKERS,
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_ROUTER_MARKERS,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  OURS_MARKER,
  remoteCapabilityFor,
  SessionHosts,
  SqliteMemoryStore,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { memoryAnswer } from '../src/daemon/memory-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/**
 * The memory layers on the daemon: a read of each project's MEMORY.md, routers and skills, a plan
 * that writes nothing, and an apply that writes only the plan confirmed, fenced, beside the
 * person's own words, and refuses one whose files changed since it was shown.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

async function fixture(): Promise<{
  home: string;
  root: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-layers-'));
  const root = join(home, 'Documents', 'acme');
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, 'macos'), { recursive: true });
  await mkdir(join(root, '.claude', 'skills', 'orders'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Acme\n\nRun the tests with pnpm.\n');
  await writeFile(join(root, 'macos', 'CLAUDE.md'), '# The Mac app\n');
  await writeFile(join(root, 'MEMORY.md'), '# Memory\n\nWe ship on Tuesdays.\n');
  await writeFile(
    join(root, '.claude', 'skills', 'orders', 'SKILL.md'),
    '# Orders\n\nQuery the orders table in Postgres.\n',
  );
  await new SessionHosts(home).note({
    sessionId: 'ses_1',
    agent: 'claude-code',
    pid: 1,
    cwd: root,
    seenAt: NOW.toISOString(),
  });
  const store = SqliteMemoryStore.forHome(home);
  const outcome = store.add(
    {
      kind: MEMORY_KIND.FACT,
      statement: 'Releases are cut from main.',
      subject: 'Releases',
      scope: MEMORY_SCOPE.PROJECT,
      project: root,
      origin: MEMORY_ORIGIN.EXTRACTED,
      tainted: false,
      evidence: [],
    },
    NOW.toISOString(),
  );
  if ('added' in outcome)
    store.decide(outcome.added.id, MEMORY_STATUS.VERIFIED, {
      by: 'person',
      at: NOW.toISOString(),
    });
  store.close();
  let id = 0;
  return {
    home,
    root,
    ask: (request) => {
      id += 1;
      return memoryAnswer(
        home,
        { id, method: DAEMON_METHOD.MEMORY_LAYERS, ...request } as DaemonRequest,
        { now: NOW, embedder: null },
      );
    },
  };
}

describe('the memory layers methods', () => {
  it('are the Mac app own, never a phone, until somebody decides otherwise', () => {
    expect(isVoiceMethod(DAEMON_METHOD.MEMORY_LAYERS_APPLY)).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.MEMORY_LAYERS_APPLY)).toBeNull();
  });

  it('reads the three layers of a project as they stand', async () => {
    const at = await fixture();
    const view = await at.ask({});
    const project = view.memoryLayers?.projects.find((each) => each.path === at.root);
    expect(project?.index).toEqual({
      path: 'MEMORY.md',
      present: true,
      lines: 4,
      unlinked: 1,
    });
    expect(project?.routers).toEqual([
      expect.objectContaining({
        agent: 'claude-code',
        path: 'CLAUDE.md',
        departments: ['macos'],
        routed: 0,
      }),
    ]);
    expect(project?.skills).toEqual([
      { name: 'orders', path: '.claude/skills/orders/SKILL.md', liveData: true },
    ]);
    expect(view.memoryLayers?.value).toEqual({});
  });

  it('previews the map without writing, and writes only the plan confirmed', async () => {
    const at = await fixture();
    const keep = ['the release branch is main'];
    const planned = await at.ask({
      method: DAEMON_METHOD.MEMORY_LAYERS_PLAN,
      memoryLayersProject: at.root,
      memoryKeep: keep,
    });
    const plan = planned.memoryLayersPlan;
    expect(plan?.files.map((file) => `${file.layer}:${file.path}`)).toEqual([
      'index:MEMORY.md',
      'memory:memory/releases.md',
      'router:CLAUDE.md',
    ]);
    expect(plan?.files[0]?.after).toEqual([
      '- [Releases](memory/releases.md) Releases are cut from main.',
    ]);
    expect(await readFile(join(at.root, 'CLAUDE.md'), 'utf8')).not.toContain(OURS_MARKER);

    const stale = await at.ask({
      method: DAEMON_METHOD.MEMORY_LAYERS_APPLY,
      memoryLayersProject: at.root,
      memoryKeep: ['something else'],
      memoryLayersDigest: plan?.digest,
    });
    expect(stale.ok).toBe(false);

    const applied = await at.ask({
      method: DAEMON_METHOD.MEMORY_LAYERS_APPLY,
      memoryLayersProject: at.root,
      memoryKeep: keep,
      memoryLayersDigest: plan?.digest,
    });
    expect(applied.memoryLayersApplied?.written).toEqual([
      'MEMORY.md',
      'memory/releases.md',
      'CLAUDE.md',
    ]);
    const router = await readFile(join(at.root, 'CLAUDE.md'), 'utf8');
    expect(router.startsWith('# Acme\n\nRun the tests with pnpm.\n')).toBe(true);
    expect(router).toContain(MEMORY_ROUTER_MARKERS.begin);
    expect(router).toContain('- macos: read macos/CLAUDE.md before working there');
    expect(router).toContain('- orders: .claude/skills/orders/SKILL.md');
    expect(await readFile(join(at.root, 'MEMORY.md'), 'utf8')).toContain(
      MEMORY_INDEX_MARKERS.begin,
    );
    const project = applied.memoryLayers?.projects[0];
    expect(project?.keep).toEqual(keep);
    expect(project?.routers[0]?.routed).toBe(1);

    const again = await at.ask({
      method: DAEMON_METHOD.MEMORY_LAYERS_PLAN,
      memoryLayersProject: at.root,
      memoryKeep: keep,
    });
    expect(again.memoryLayersPlan?.files.every((file) => !file.changed)).toBe(true);
  });

  it('refuses a project that is not here, an agent not in it, and a keep list that is not lines', async () => {
    const at = await fixture();
    for (const request of [
      { memoryLayersProject: '/nowhere' },
      { memoryLayersProject: at.root, memoryLayersAgent: 'gemini-cli' },
      { memoryLayersProject: at.root, memoryKeep: [1] as unknown as string[] },
    ])
      expect(
        (await at.ask({ method: DAEMON_METHOD.MEMORY_LAYERS_PLAN, ...request })).ok,
      ).toBe(false);
  });

  it('counts cold reloads over the chats lately and keeps search times for the value line', async () => {
    const at = await fixture();
    const projects = join(at.home, '.claude', 'projects', '-acme');
    await mkdir(projects, { recursive: true });
    const turn = (id: string, at: string, write: number, read: number): string =>
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: {
          id,
          model: 'claude-sonnet-5-5',
          usage: { cache_creation_input_tokens: write, cache_read_input_tokens: read },
        },
      });
    await writeFile(
      join(projects, 'ses-2.jsonl'),
      [
        turn('m1', '2026-10-29T10:00:00Z', 10_000, 0),
        turn('m2', '2026-10-29T10:30:00Z', 1_000_000, 0),
      ].join('\n'),
    );
    const cost = await at.ask({ method: DAEMON_METHOD.SESSION_COST });
    expect(cost.sessionCost).toMatchObject({
      sessions: 1,
      turns: 2,
      coldReloads: 1,
      reloadCostUsd: 2.5,
    });
    expect(
      (await at.ask({ method: DAEMON_METHOD.MEMORY_SEARCH, memoryQuery: 'releases' })).ok,
    ).toBe(true);
    const value = (await at.ask({})).memoryLayers?.value;
    expect(value?.searches).toBe(1);
    expect(typeof value?.searchMedianMs).toBe('number');
  });
});
