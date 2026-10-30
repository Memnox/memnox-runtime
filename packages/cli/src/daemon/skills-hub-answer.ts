import {
  isOrgSkill,
  orgSkillOwned,
  readOrgSkills,
  readSkillsHub,
  SKILL_INSTRUCTIONS,
  SKILL_SCOPE,
  SKILLS_METHOD,
  skillNameOf,
  skillNamed,
  type CanonicalSkill,
  type DaemonRequest,
  type DaemonResponse,
  type SkillDraft,
  type SkillScope,
} from '@memnox/core';
import { canonicalOf, foundDefinitions } from '../skills/skill-import';
import {
  acceptSkill,
  assignSkill,
  putSkill,
  rollbackSkill,
  setSkillEnabled,
  type SkillsChanged,
} from '../skills/skills-changes';
import { readSkillsView } from '../skills/skills-view';
import { syncSkills } from '../skills/skills-writer';

/**
 * The Skills Hub's methods. A skill given to an agent, or a version reaching further than the one
 * accepted, is proposed and holds once the person signs it; taking one away is done at once.
 */

const SKILLS_METHODS: readonly string[] = Object.values(SKILLS_METHOD);
const SCOPES: readonly string[] = Object.values(SKILL_SCOPE);

export function isSkillsMethod(method: string): boolean {
  return SKILLS_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every answer carries the hub as it now stands, so a screen redraws from one answer. */
export async function skillsHubAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return { id: request.id, ...answered, skillsHub: await readSkillsView(home) };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const name = request.skillName;
  switch (request.method) {
    case SKILLS_METHOD.SKILL_IMPORT:
      return importOne(home, request, now);
    case SKILLS_METHOD.SKILL_PUT:
      return put(home, request, now);
    case SKILLS_METHOD.SKILL_SYNC:
      return changedAnswer({
        synced: await syncSkills(home, await readSkillsHub(home), now),
      });
    case SKILLS_METHOD.SKILLS_HUB:
      return { ok: true };
  }
  if (name === undefined || name === '') return refused('Name the skill.');
  if (await onlyOrganizations(home, name)) return refused(orgSkillOwned(name));
  return namedAnswer(home, { request, name, now });
}

/** A name only the organization holds, which this machine reads and never changes. */
async function onlyOrganizations(home: string, name: string): Promise<boolean> {
  if (skillNamed(await readSkillsHub(home), name) !== undefined) return false;
  return organizationHolds(home, name);
}

/** Whether the organization published a skill by this name, kept or refused at the pull. */
async function organizationHolds(home: string, name: string): Promise<boolean> {
  const org = await readOrgSkills(home);
  return isOrgSkill(org.skills, name) || org.refused.some((each) => each.name === name);
}

/** The changes that name one skill already in the hub. */
async function namedAnswer(
  home: string,
  { request, name, now }: { request: DaemonRequest; name: string; now: Date },
): Promise<Answered> {
  switch (request.method) {
    case SKILLS_METHOD.SKILL_ASSIGN:
      return assign(home, { request, name, now });
    case SKILLS_METHOD.SKILL_DISABLE:
      return changedAnswer(await setSkillEnabled(home, name, false, now));
    case SKILLS_METHOD.SKILL_ENABLE:
      return changedAnswer(await setSkillEnabled(home, name, true, now));
    case SKILLS_METHOD.SKILL_ACCEPT:
      return changedAnswer(await acceptSkill(home, name, now));
    case SKILLS_METHOD.SKILL_ROLLBACK:
      if (request.skillVersion === undefined)
        return refused('Name the version to hand out again.');
      return changedAnswer(await rollbackSkill(home, name, request.skillVersion, now));
    default:
      return { ok: true };
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

function changedAnswer(changed: SkillsChanged): Answered {
  if ('refused' in changed) return refused(changed.refused);
  if ('proposed' in changed) return { ok: true, proposed: changed.proposed };
  return { ok: true, skillsSynced: changed.synced.summary };
}

async function assign(
  home: string,
  { request, name, now }: { request: DaemonRequest; name: string; now: Date },
): Promise<Answered> {
  const agent = request.skillAgent;
  if (agent === undefined || request.skillOn === undefined)
    return refused('Name the agent, and whether the skill is given or taken away.');
  const project = request.skillProject;
  return changedAnswer(
    await assignSkill(
      home,
      { name, agent, on: request.skillOn, ...(project === undefined ? {} : { project }) },
      now,
    ),
  );
}

/** Where a project skill lives must be named; a personal one lives under the Memnox home. */
function placeOf(request: DaemonRequest): { scope: SkillScope; project?: string } | null {
  const scope = request.skillScope ?? SKILL_SCOPE.PERSONAL;
  // The organization's scope is written only by the bundle pull, never from a screen.
  if (!SCOPES.includes(scope) || scope === SKILL_SCOPE.ORGANIZATION) return null;
  if (scope === SKILL_SCOPE.PERSONAL) return { scope };
  return request.skillProject === undefined
    ? null
    : { scope, project: request.skillProject };
}

async function importOne(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const place = placeOf(request);
  if (place === null) return refused('Say personal, or project with its repository.');
  const found = (await foundDefinitions(home, place.project)).find(
    (each) => each.id === request.skillFoundId,
  );
  if (found === undefined) return refused('Name a skill found on this computer.');
  const name = skillNameOf(found.name);
  if (skillNamed(await readSkillsHub(home), name) !== undefined)
    return refused(`The hub already has a skill named ${name}.`);
  if (await organizationHolds(home, name))
    return refused(`The organization already provides a skill named ${name}.`);
  const skill = await canonicalOf(found, name);
  if ('refused' in skill) return refused(skill.refused);
  return changedAnswer(await putSkill(home, { skill, ...place }, now));
}

async function put(home: string, request: DaemonRequest, now: Date): Promise<Answered> {
  const place = placeOf(request);
  if (place === null) return refused('Say personal, or project with its repository.');
  const skill = canonicalFromDraft(request.skillDraft);
  if (skill === null)
    return refused(
      'Send the skill as a name, a version, a description and its instructions.',
    );
  if (await onlyOrganizations(home, skill.manifest.name))
    return refused(orgSkillOwned(skill.manifest.name));
  return changedAnswer(await putSkill(home, { skill, ...place }, now));
}

/** The skill as a screen sent it, which is untrusted JSON until every field is checked. */
function canonicalFromDraft(value: unknown): CanonicalSkill | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Partial<Record<keyof SkillDraft, unknown>>;
  const { name, version, description, instructions } = raw;
  if (
    ![name, version, description, instructions].every((each) => typeof each === 'string')
  )
    return null;
  const lists = listsOf(raw);
  const files = filesOf(raw.files);
  if (lists === null || files === null) return null;
  return {
    manifest: {
      // Casts are safe: all four were checked to be text just above.
      name: name as string,
      version: version as string,
      description: description as string,
      ...(typeof raw.category === 'string' ? { category: raw.category } : {}),
      ...(typeof raw.publisher === 'string' ? { publisher: raw.publisher } : {}),
      digest: '',
      ...lists,
    },
    instructions: instructions as string,
    files,
  };
}

type Lists = Pick<
  CanonicalSkill['manifest'],
  'tools' | 'mcpServers' | 'dependencies' | 'agents' | 'permissions'
>;

function listsOf(raw: Partial<Record<keyof SkillDraft, unknown>>): Lists | null {
  const permissions =
    typeof raw.permissions === 'object' && raw.permissions !== null
      ? // Cast is safe: each list in it is checked below.
        (raw.permissions as Record<string, unknown>)
      : {};
  const read = [
    raw.tools,
    raw.mcpServers,
    raw.dependencies,
    raw.agents,
    permissions['filesystem'],
    permissions['network'],
    permissions['commands'],
  ].map(listOf);
  if (read.some((each) => each === null)) return null;
  // Cast is safe: none of them is null, checked just above.
  const [tools, mcpServers, dependencies, agents, filesystem, network, commands] =
    read as string[][];
  return {
    tools: tools ?? [],
    mcpServers: mcpServers ?? [],
    dependencies: dependencies ?? [],
    agents: agents ?? [],
    permissions: {
      filesystem: filesystem ?? [],
      network: network ?? [],
      commands: commands ?? [],
    },
  };
}

function listOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? [...value]
    : null;
}

function filesOf(value: unknown): CanonicalSkill['files'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const files: CanonicalSkill['files'] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return null;
    // Cast is safe: both fields are checked to be text before either is kept.
    const { path, text } = each as Record<string, unknown>;
    if (
      typeof path !== 'string' ||
      typeof text !== 'string' ||
      path === SKILL_INSTRUCTIONS
    )
      return null;
    files.push({ path, bytes: Buffer.from(text, 'utf8') });
  }
  return files;
}
