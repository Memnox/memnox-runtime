import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareVersions,
  describeGrant,
  personalVersions,
  readOrgSkills,
  readSkillsHub,
  SKILL_FORMATS,
  SKILL_SCOPE,
  type CanonicalSkill,
  type DiscoveredSkill,
  type FoundSkillView,
  type HubSkill,
  type RefusedOrgSkill,
  type SkillCompatibility,
  type SkillsHub,
  type SkillsHubView,
  type SkillVersionView,
  type SkillView,
} from '@memnox/core';
import { orgHubSkills } from './org-skill-hub';
import { foundDefinitions } from './skill-import';
import { readKeptSkill, type KeptSkill } from './skill-standing';

/**
 * The Skills Hub as a screen draws it: each skill with what every agent keeps of it, its versions
 * and whether it is held, the skills found in agents' folders to import, and the agents that take them.
 */

const NO_PERMISSIONS = { filesystem: [], network: [], commands: [] };

export async function readSkillsView(home: string): Promise<SkillsHubView> {
  const hub = await readSkillsHub(home);
  const skills: SkillView[] = [];
  for (const skill of hub.skills) skills.push(await skillView(home, skill));
  skills.push(...(await orgViews(home, hub)));
  return {
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    found: foundViews(hub, await foundDefinitions(home)),
    agents: SKILL_FORMATS.map((format) => ({
      agent: format.agent,
      label: format.label,
      installed: existsSync(join(home, format.installedDir)),
    })),
  };
}

async function skillView(home: string, skill: HubSkill): Promise<SkillView> {
  return viewOf(skill, await readKeptSkill(home, skill), await versionsOf(home, skill));
}

/**
 * The organization's skills, each its one version, and the ones refused at the pull with why, so a
 * person sees what Memnox Cloud sent and nothing of a skill that did not match its digest is written.
 */
async function orgViews(home: string, hub: SkillsHub): Promise<SkillView[]> {
  const handed = (await orgHubSkills(home, hub)).map(({ org, skill, read }) =>
    viewOf(skill, read, [{ version: org.version, current: true, digest: org.digest }]),
  );
  const local = new Set(hub.skills.map((skill) => skill.name));
  const refused = (await readOrgSkills(home)).refused
    .filter((each) => !local.has(each.name))
    .map((each) => refusedView(each));
  return [...handed, ...refused];
}

function refusedView(refused: RefusedOrgSkill): SkillView {
  const skill: HubSkill = {
    name: refused.name,
    scope: SKILL_SCOPE.ORGANIZATION,
    current: refused.version,
    enabled: false,
    accepted: [],
    assignments: [],
    updatedAt: '',
  };
  const problems = [`Not written into any agent, because ${refused.reason}.`];
  return viewOf(skill, { digest: '', problems, reaches: [] }, []);
}

function viewOf(
  skill: HubSkill,
  read: KeptSkill,
  versions: SkillVersionView[],
): SkillView {
  const manifest = read.skill === undefined ? undefined : read.skill.manifest;
  return {
    name: skill.name,
    scope: skill.scope,
    ...(skill.project === undefined ? {} : { project: skill.project }),
    ...(manifest === undefined || manifest.category === undefined
      ? {}
      : { category: manifest.category }),
    ...(manifest === undefined || manifest.publisher === undefined
      ? {}
      : { publisher: manifest.publisher }),
    version: skill.current,
    description: manifest === undefined ? '' : manifest.description,
    enabled: skill.enabled,
    digest: read.digest,
    ...(read.held === undefined ? {} : { held: read.held }),
    agents: [...new Set(skill.assignments.map((each) => each.agent))],
    assignments: skill.assignments.map((each) => ({ ...each })),
    compatibility: read.skill === undefined ? [] : compatibilityOf(read.skill, skill),
    versions,
    updatedAt: skill.updatedAt,
    ...contentOf(read),
    ...(read.problems === undefined ? {} : { problems: read.problems }),
  };
}

type Content = Pick<
  SkillView,
  'files' | 'instructions' | 'tools' | 'mcpServers' | 'permissions' | 'dependencies'
>;

function contentOf(read: KeptSkill): Content {
  const skill = read.skill;
  if (skill === undefined)
    return {
      files: [],
      instructions: '',
      tools: [],
      mcpServers: [],
      permissions: NO_PERMISSIONS,
      dependencies: [],
    };
  return {
    files: skill.files.map((file) => file.path),
    instructions: skill.instructions,
    tools: [...skill.manifest.tools],
    mcpServers: [...skill.manifest.mcpServers],
    permissions: { ...skill.manifest.permissions },
    dependencies: [...skill.manifest.dependencies],
  };
}

/** What each agent keeps of it, translated where it is written, the home folder unless it is a project's. */
function compatibilityOf(
  canonical: CanonicalSkill,
  skill: HubSkill,
): SkillCompatibility[] {
  const project = skill.scope === SKILL_SCOPE.PROJECT;
  return SKILL_FORMATS.map((format) => ({
    agent: format.agent,
    label: format.label,
    supported: true,
    loses: format.translate(canonical, { project, hasSkillsFolder: false }).loses,
  }));
}

/** Every version kept or accepted, oldest first. */
async function versionsOf(home: string, skill: HubSkill): Promise<SkillVersionView[]> {
  const kept =
    skill.scope === SKILL_SCOPE.PERSONAL ? await personalVersions(home, skill.name) : [];
  const numbers = [
    ...new Set([...skill.accepted.map((each) => each.version), ...kept, skill.current]),
  ].sort(compareVersions);
  return numbers.map((version) => {
    const accepted = skill.accepted.find((each) => each.version === version);
    return {
      version,
      current: version === skill.current,
      ...(accepted === undefined
        ? {}
        : { acceptedAt: accepted.acceptedAt, digest: accepted.digest }),
    };
  });
}

/** Found in agents' folders, leaving out what the hub itself wrote there. */
function foundViews(hub: SkillsHub, found: readonly DiscoveredSkill[]): FoundSkillView[] {
  const ours = new Set(hub.written.map((each) => join(each.root, each.path)));
  const names = new Set(hub.skills.map((each) => each.name));
  return found
    .filter((each) => !ours.has(each.path))
    .map((each) => ({
      id: each.id,
      name: each.name,
      agent: each.agent,
      kind: each.kind,
      path: each.path,
      tools: [...each.grant.tools],
      grant: describeGrant(each.grant),
      imported: names.has(each.name),
    }));
}
