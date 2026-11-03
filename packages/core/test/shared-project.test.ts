import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  orgProjectOwned,
  orgProjectsFrom,
  readOrgProjects,
  resolveOrgProject,
  sharedProjectFor,
  sharedProjectMemoryKey,
  sharedRepositoryOf,
  writeOrgProjects,
  type OrgProject,
} from '../src/index';

/**
 * A shared project as the bundle carries it: matched to a clone by the same reduction of its
 * remote Memnox Cloud makes, its names looked up in the same bundle, and kept read only.
 */

const API: OrgProject = {
  id: 'proj_1',
  name: 'API',
  repository: 'github.com/acme/api',
  repositories: ['github.com/acme/api'],
  mcpServers: ['linear', 'gone'],
  skills: ['release'],
  rulePack: 'api',
  memory: 'project',
};

describe("a repository's shared identity, as Memnox Cloud reduces it", () => {
  it.each([
    ['git@github.com:acme/api.git', 'github.com/acme/api'],
    ['https://github.com/Acme/API', 'github.com/acme/api'],
    ['https://user:secret@github.com/acme/api.git/', 'github.com/acme/api'],
    ['ssh://git@github.com:22/acme/api.git', 'github.com/acme/api'],
    ['git+ssh://git@gitlab.com/group/sub/api.git', 'gitlab.com/group/sub/api'],
    ['github.com/acme/api', 'github.com/acme/api'],
  ])('reduces %s to the one name every clone shares', (remote, identity) => {
    expect(sharedRepositoryOf(remote)).toBe(identity);
  });

  it.each([
    '/home/ada/src/api',
    '~/src/api',
    './api',
    'C:\\src\\api',
    'file:///srv/git/api.git',
    'github.com/api',
    'api',
    '',
  ])('refuses %s, which is a path or not a remote', (remote) => {
    expect(sharedRepositoryOf(remote)).toBeUndefined();
  });
});

describe('shared projects from the bundle', () => {
  it('keeps a whole project and drops one with a path for a repository', () => {
    const read = orgProjectsFrom([
      { ...API, audience: ['x'] },
      { ...API, id: 'proj_2', repository: '/home/ada/api' },
      { ...API, id: 'proj_3', memory: 'personal' },
    ]);
    expect(read.map((project) => project.id)).toEqual(['proj_1']);
  });

  it('matches a clone by identity and nothing else', () => {
    expect(sharedProjectFor([API], 'github.com/acme/api')).toEqual(API);
    expect(sharedProjectFor([API], 'github.com/acme/web')).toBeUndefined();
    expect(sharedProjectFor([API], undefined)).toBeUndefined();
  });

  it('looks each name up in the bundle and says the ones it skipped', () => {
    const resolved = resolveOrgProject(API, {
      servers: ['linear'],
      skills: [],
      ruleProjects: ['api', 'api', 'web'],
    });
    expect(resolved.servers).toEqual(['linear']);
    expect(resolved.skills).toEqual([]);
    expect(resolved.rules).toBe(2);
    expect(resolved.skipped).toHaveLength(2);
    expect(resolved.skipped[0]).toContain('gone');
  });

  it('says a rule pack no rule carries', () => {
    const resolved = resolveOrgProject(API, {
      servers: [],
      skills: [],
      ruleProjects: [],
    });
    expect(resolved.skipped.some((line) => line.includes('rule pack'))).toBe(true);
  });

  it('keeps memory on the cloud id and refuses local edits with the cloud line', () => {
    expect(sharedProjectMemoryKey(API)).toBe('org-project:proj_1');
    expect(orgProjectOwned('API')).toContain('Memnox Cloud');
  });

  it('writes only when the projects changed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-org-projects-'));
    expect(await writeOrgProjects(home, [API])).toBe(true);
    expect(await writeOrgProjects(home, [API])).toBe(false);
    expect(await readOrgProjects(home)).toEqual([API]);
  });
});

describe('a project spanning several repositories', () => {
  const SPANNING = {
    id: 'proj_2',
    name: 'Shop',
    repository: 'github.com/acme/shop-web',
    repositories: ['github.com/acme/shop-web', 'github.com/acme/shop-api'],
    mcpServers: [],
    skills: [],
    memory: 'project',
  };

  it('is the same project, under the same id, from a clone of any of them', () => {
    const [project] = orgProjectsFrom([SPANNING]);
    expect(project?.repositories).toEqual(SPANNING.repositories);
    expect(sharedProjectFor(orgProjectsFrom([SPANNING]), 'github.com/acme/shop-api')?.id).toBe(
      'proj_2',
    );
    expect(sharedProjectFor(orgProjectsFrom([SPANNING]), 'github.com/acme/shop-web')?.id).toBe(
      'proj_2',
    );
  });

  it('still reads a project an older cloud sent with one repository', () => {
    const { repositories: _dropped, ...older } = SPANNING;
    const [project] = orgProjectsFrom([older]);
    expect(project?.repositories).toEqual(['github.com/acme/shop-web']);
  });

  it('leaves out one naming a path rather than a remote, rather than half laying it', () => {
    expect(
      orgProjectsFrom([{ ...SPANNING, repositories: ['github.com/acme/shop-web', '/home/ada/shop'] }]),
    ).toEqual([]);
  });
});
