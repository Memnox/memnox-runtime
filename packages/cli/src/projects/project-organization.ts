import { existsSync } from 'node:fs';
import {
  loadPoliciesFromFile,
  orgPolicyPathFor,
  orgProjectOwned,
  readOrgProjects,
  readOrgServers,
  readOrgSkills,
  resolveOrgProject,
  sharedProjectFor,
  sharedProjectMemoryKey,
  sharedRepositoryOf,
  SHARED_PROJECT_MEMORY,
  type OrgProject,
  type Policy,
  type ProjectOrganizationView,
} from '@memnox/core';
import { originUrlOf } from '@memnox/interceptors';

/**
 * The organization's shared projects laid over the clones on this machine: a clone whose
 * `origin` reduces to a shared repository reads that project's servers, skills, rule pack and
 * memory from the bundle, and nothing here may change them.
 */

/** What the last bundle carried, read once so every project is matched against the same pull. */
export interface OrgOverlay {
  projects: OrgProject[];
  servers: string[];
  skills: string[];
  /** The `project` each of the organization's rules carries, once per rule. */
  ruleProjects: string[];
}

/** Reads a clone's `origin`; injected so a test needs no git. */
type OriginOf = (root: string) => string | undefined;

export async function readOrgOverlay(home: string): Promise<OrgOverlay> {
  const projects = await readOrgProjects(home);
  if (projects.length === 0)
    return { projects, servers: [], skills: [], ruleProjects: [] };
  const [servers, skills, ruleProjects] = await Promise.all([
    readOrgServers(home),
    readOrgSkills(home),
    orgRuleProjects(home),
  ]);
  return {
    projects,
    servers: servers.map((server) => server.name),
    skills: skills.skills.map((skill) => skill.name),
    ruleProjects,
  };
}

async function orgRuleProjects(home: string): Promise<string[]> {
  const path = orgPolicyPathFor(home);
  if (!existsSync(path)) return [];
  const rules = await loadPoliciesFromFile(path).catch(
    // A bundle that will not load is said on the rules page; here it simply carries no pack.
    (): Policy[] => [],
  );
  return rules.flatMap((rule) => (rule.project === undefined ? [] : [rule.project]));
}

/** The shared project this clone is, by its remote reduced the way Memnox Cloud reduces it. */
export function sharedProjectAt(
  root: string,
  projects: readonly OrgProject[],
  originOf: OriginOf = originUrlOf,
): OrgProject | undefined {
  if (projects.length === 0) return undefined;
  const origin = originOf(root);
  return sharedProjectFor(
    projects,
    origin === undefined ? undefined : sharedRepositoryOf(origin),
  );
}

/** The project as a screen draws it, read only, with every name the bundle lacked said. */
export function organizationView(
  project: OrgProject,
  overlay: OrgOverlay,
): ProjectOrganizationView {
  const resolved = resolveOrgProject(project, overlay);
  return {
    id: project.id,
    name: project.name,
    repository: project.repository,
    ...(project.description === undefined ? {} : { description: project.description }),
    servers: resolved.servers,
    skills: resolved.skills,
    ...(project.rulePack === undefined ? {} : { rulePack: project.rulePack }),
    rules: resolved.rules,
    memory: project.memory,
    skipped: resolved.skipped,
    editedIn: orgProjectOwned(project.name),
  };
}

/** Where memory learned in this clone is kept: the shared project's key, nothing, or the clone itself. */
export async function projectMemoryKey(
  home: string,
  root: string,
  originOf: OriginOf = originUrlOf,
): Promise<{ key: string } | { none: true }> {
  const shared = sharedProjectAt(root, await readOrgProjects(home), originOf);
  if (shared === undefined) return { key: root };
  if (shared.memory === SHARED_PROJECT_MEMORY.NONE) return { none: true };
  return { key: sharedProjectMemoryKey(shared) };
}
