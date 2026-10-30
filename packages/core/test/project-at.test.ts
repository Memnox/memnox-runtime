import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyManifest,
  LocalGate,
  projectIdAt,
  projectIdOf,
  SHARED_PROJECT_MEMORY,
  writeOrgProjects,
  writeProjectManifest,
  writeProjectState,
  type Policy,
} from '../src/index';

/** Where an action runs decides which project scoped rules can decide it. */

const AT = '2026-10-30T12:00:00.000Z';
const ORIGIN = 'git@github.com:acme/billing.git';

async function folders(): Promise<{ home: string; repo: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-project-at-home-'));
  const repo = await mkdtemp(join(tmpdir(), 'memnox-project-at-repo-'));
  return { home, repo };
}

async function opened(home: string, repo: string, ruleFile?: string): Promise<void> {
  await writeProjectState(home, {
    id: projectIdOf(repo),
    root: repo,
    openedAt: AT,
    written: [],
  });
  await writeProjectManifest(repo, {
    ...emptyManifest('billing'),
    ...(ruleFile === undefined ? {} : { policy: ruleFile }),
  });
}

const noOrigin = async (): Promise<string | undefined> => undefined;

describe('the project an action belongs to', () => {
  it('is the project an opened project declares in its rule file, from any folder inside it', async () => {
    const { home, repo } = await folders();
    await writeFile(
      join(repo, 'memnox.policies.toml'),
      'version = 1\nproject = "billing"\npolicies = []\n',
    );
    await opened(home, repo, 'memnox.policies.toml');
    await mkdir(join(repo, 'src', 'api'), { recursive: true });
    expect(await projectIdAt(home, join(repo, 'src', 'api'), noOrigin)).toBe('billing');
  });

  it('is nothing outside every opened project, or where the rule file declares none', async () => {
    const { home, repo } = await folders();
    await writeFile(join(repo, 'rules.toml'), 'version = 1\npolicies = []\n');
    await opened(home, repo, 'rules.toml');
    expect(await projectIdAt(home, repo, noOrigin)).toBeUndefined();
    expect(await projectIdAt(home, tmpdir(), noOrigin)).toBeUndefined();
  });

  it("is a shared clone's organization rule pack, by its origin", async () => {
    const { home, repo } = await folders();
    await writeOrgProjects(home, [
      {
        id: 'prj_1',
        name: 'Billing',
        repository: 'github.com/acme/billing',
        mcpServers: [],
        skills: [],
        rulePack: 'billing-pack',
        memory: SHARED_PROJECT_MEMORY.PROJECT,
      },
    ]);
    expect(await projectIdAt(home, repo, async () => ORIGIN)).toBe('billing-pack');
    expect(
      await projectIdAt(home, repo, async () => 'git@github.com:acme/other.git'),
    ).toBeUndefined();
  });

  it('lets a project scoped rule decide once the request carries it', () => {
    const rule: Policy = {
      name: 'billing-no-deploy',
      project: 'billing-pack',
      match: { actions: ['deploy.service'] },
      decision: { effect: 'deny', reason: 'billing deploys go through release' },
    };
    const gate = new LocalGate([rule], { agentName: 'claude-code' });
    expect(gate.evaluate({ action: 'deploy.service' }).effect).toBe('allow');
    expect(
      gate.evaluate({ action: 'deploy.service', projectId: 'billing-pack' }).effect,
    ).toBe('deny');
  });
});
