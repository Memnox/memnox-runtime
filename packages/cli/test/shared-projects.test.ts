import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  HUB_TRANSPORT,
  MEMORY_SCOPE,
  PROJECT_SCOPE,
  readOrgProjects,
  SessionHosts,
  SqliteMemoryStore,
  type DaemonRequest,
} from '@memnox/core';
import { projectsAnswer } from '../src/daemon/projects-answer';
import { projectMemoryKey } from '../src/projects/project-organization';
import { applyBundle, type Bundle } from '../src/sync/bundle';
import { suggestTool } from '../src/session-tools/suggest-tool';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

/**
 * A repository the organization shares, laid over the clone whose `origin` reduces to it: its
 * servers, skills and rule pack read from the same bundle, its memory kept on the cloud's id
 * apart from the person's own, and every local edit refused with the Memnox Cloud line.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const API_PROJECT = {
  id: 'proj_api',
  name: 'API',
  repository: 'github.com/acme/api',
  mcpServers: ['linear', 'retired'],
  skills: ['release'],
  rulePack: 'api',
  memory: 'project',
};

const BUNDLE: Bundle = {
  hash: 'h1',
  policies: [],
  rules: [
    {
      id: 'api-no-deploy',
      policyHash: 'p1',
      line: 1,
      domain: 'deploy',
      effect: 'deny',
      specificity: 10,
      match: 'deploy.run',
      project: 'api',
    },
  ],
  conditions: [],
  tags: [],
  mcpServers: [
    {
      name: 'linear',
      transport: HUB_TRANSPORT.HTTP,
      url: 'https://mcp.linear.app/mcp',
      env: {},
      secrets: {},
    },
  ],
  projects: [API_PROJECT],
};

async function clone(remote: string): Promise<{ home: string; root: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-shared-projects-'));
  const root = join(home, 'src', 'api');
  await mkdir(root, { recursive: true });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote]);
  await new SessionHosts(home).note({
    sessionId: 'ses_1',
    agent: 'claude-code',
    pid: 1,
    cwd: root,
    seenAt: NOW.toISOString(),
  });
  await applyBundle(home, BUNDLE);
  return { home, root };
}

function ask(
  home: string,
  request: Partial<DaemonRequest>,
): ReturnType<typeof projectsAnswer> {
  return projectsAnswer(
    home,
    { id: 1, method: DAEMON_METHOD.PROJECTS, ...request } as DaemonRequest,
    NOW,
  );
}

describe('a shared project over its clone', () => {
  it('keeps the projects the bundle carried', async () => {
    const { home } = await clone('git@github.com:Acme/API.git');
    expect((await readOrgProjects(home)).map((project) => project.id)).toEqual([
      'proj_api',
    ]);
  });

  it('shows the clone as the organization scope, with each missing name said', async () => {
    const { home, root } = await clone('git@github.com:Acme/API.git');
    const view = (await ask(home, {})).projects?.projects.find(
      (each) => each.path === root,
    );
    expect(view?.scope).toBe(PROJECT_SCOPE.ORGANIZATION);
    expect(view?.organization).toMatchObject({
      id: 'proj_api',
      servers: ['linear'],
      skills: [],
      rulePack: 'api',
      rules: 1,
      memory: 'project',
    });
    expect(view?.organization?.skipped.join(' ')).toContain('retired');
    expect(view?.organization?.editedIn).toContain('Memnox Cloud');
  });

  it('leaves a clone of another repository its own', async () => {
    const { home, root } = await clone('https://github.com/acme/web.git');
    const view = (await ask(home, {})).projects?.projects.find(
      (each) => each.path === root,
    );
    expect(view?.scope).toBeUndefined();
    expect(view?.organization).toBeUndefined();
  });

  it('refuses writing the manifest of a shared project', async () => {
    const { home, root } = await clone('ssh://git@github.com:22/acme/api.git');
    const answer = await ask(home, {
      method: DAEMON_METHOD.PROJECT_PUT,
      projectPath: root,
      projectDraft: { name: 'mine' },
    });
    expect(answer.ok).toBe(false);
    expect(answer.reason).toBe(
      "API is the organization's project, so it is changed in Memnox Cloud rather than here.",
    );
  });

  it('keeps what an agent learns there on the project id, apart from personal memory', async () => {
    const { home, root } = await clone('git@github.com:acme/api.git');
    expect(await projectMemoryKey(home, root)).toEqual({ key: 'org-project:proj_api' });
    const deps = { home, cwd: root, agent: 'claude-code', now: () => NOW };
    await suggestTool(deps as SessionToolDeps, {
      statement: 'Deploys go out on Tuesdays',
    });
    const store = SqliteMemoryStore.forHome(home);
    const [item] = store.items();
    store.close();
    expect(item?.scope).toBe(MEMORY_SCOPE.PROJECT);
    expect(item?.project).toBe('org-project:proj_api');
  });

  it('keeps nothing where the organization said the project keeps no memory', async () => {
    const { home, root } = await clone('git@github.com:acme/api.git');
    await applyBundle(home, {
      ...BUNDLE,
      hash: 'h2',
      projects: [{ ...API_PROJECT, memory: 'none' }],
    });
    const deps = { home, cwd: root, agent: 'claude-code', now: () => NOW };
    const said = await suggestTool(deps as SessionToolDeps, { statement: 'x' });
    expect(said).toMatchObject({ refused: expect.stringContaining('no memory') });
  });
});
