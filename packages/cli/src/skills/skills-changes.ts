import { rm } from 'node:fs/promises';
import {
  folderDigest,
  minutesToMs,
  personalSkillDirFor,
  PROPOSAL_KIND,
  Proposals,
  readSkillsHub,
  reachesOf,
  SKILL_SCOPE,
  skillDirFor,
  skillNamed,
  skillProblems,
  skillStandingOf,
  takesSkills,
  verbTableNames,
  withAccepted,
  withSkill,
  withSkillAssignment,
  withoutSkill,
  writeCanonicalSkill,
  writeSkillsHub,
  type AcceptedSkillVersion,
  type CanonicalSkill,
  type HubSkill,
  type SkillScope,
  type SkillsChange,
  type SkillsHub,
} from '@memnox/core';
import { syncSkills, type SkillsSynced } from './skills-writer';
import { readKeptSkill } from './skill-standing';

/**
 * The Skills Hub's writes. Anything that lets an agent do more, a skill given to it or a version
 * reaching further, is a proposal the person signs; taking a skill away is done at once.
 */

export type SkillsChanged =
  { synced: SkillsSynced } | { proposed: string } | { refused: string };

/** Who the card names as having proposed it: the hub, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-skills';
const PROPOSAL_TTL_MS = minutesToMs(5);

interface SkillPut {
  skill: CanonicalSkill;
  scope: SkillScope;
  project?: string;
}

/** A new skill, or a new version of one; held and proposed when it reaches further than the last accepted. */
export async function putSkill(
  home: string,
  put: SkillPut,
  now: Date,
): Promise<SkillsChanged> {
  const problems = skillProblems(put.skill);
  if (problems.length > 0) return { refused: problems.join(' ') };
  const hub = await readSkillsHub(home);
  const before = skillNamed(hub, put.skill.manifest.name);
  const refusal = placeRefusal(before, put);
  if (refusal !== null) return { refused: refusal };
  const kept = await keepVersion(home, before, put);
  if ('refused' in kept) return kept;
  const at = now.toISOString();
  const skill = {
    ...(before ?? newSkill(put, at)),
    current: put.skill.manifest.version,
    updatedAt: at,
  };
  const record: AcceptedSkillVersion = {
    version: skill.current,
    digest: kept.digest,
    tools: put.skill.manifest.tools,
    reaches: reachesOf(put.skill, verbTableNames()),
    acceptedAt: at,
  };
  return acceptOrPropose(home, { hub, skill, record }, now);
}

/** Accepted and handed out at once, or kept held and proposed when it reaches further than the last accepted. */
async function acceptOrPropose(
  home: string,
  {
    hub,
    skill,
    record,
  }: { hub: SkillsHub; skill: HubSkill; record: AcceptedSkillVersion },
  now: Date,
): Promise<SkillsChanged> {
  const standing = skillStandingOf(skill, record);
  if (!standing.widened)
    return {
      synced: await syncSkills(home, withSkill(hub, withAccepted(skill, record)), now),
    };
  await writeSkillsHub(home, withSkill(hub, skill));
  const accept = { name: skill.name, version: record.version, digest: record.digest };
  const rationale = `Accept ${skill.name} ${record.version}, which now also ${standing.gained.join(', ')}`;
  return propose(home, { accept }, { rationale, now });
}

function newSkill(put: SkillPut, at: string): HubSkill {
  return {
    name: put.skill.manifest.name,
    scope: put.scope,
    ...(put.project === undefined ? {} : { project: put.project }),
    current: put.skill.manifest.version,
    enabled: true,
    accepted: [],
    assignments: [],
    updatedAt: at,
  };
}

function placeRefusal(before: HubSkill | undefined, put: SkillPut): string | null {
  if (put.scope === SKILL_SCOPE.PROJECT && put.project === undefined)
    return 'Name the repository a project skill lives in.';
  if (before === undefined) return null;
  if (before.scope !== put.scope || before.project !== put.project)
    return `${before.name} is already kept as a ${before.scope} skill.`;
  return null;
}

/** The version's folder written, unless an accepted version of that number holds other files. */
async function keepVersion(
  home: string,
  before: HubSkill | undefined,
  put: SkillPut,
): Promise<{ digest: string } | { refused: string }> {
  const { name, version } = put.skill.manifest;
  const dir = skillDirFor(home, {
    name,
    version,
    scope: put.scope,
    ...(put.project === undefined ? {} : { project: put.project }),
  });
  const accepted = before?.accepted.find((each) => each.version === version);
  // An accepted version is what agents were handed, so a version number is never reused for other files.
  if (accepted !== undefined && folderDigest(put.skill) !== accepted.digest)
    return {
      refused: `${version} is kept already with other files, so give this one a new version.`,
    };
  return { digest: await writeCanonicalSkill(dir, put.skill) };
}

/** A held skill's folder accepted as it is now: at once, or proposed where it reaches further. */
export async function acceptSkill(
  home: string,
  name: string,
  now: Date,
): Promise<SkillsChanged> {
  const hub = await readSkillsHub(home);
  const skill = skillNamed(hub, name);
  if (skill === undefined) return { refused: `The hub has no skill named ${name}.` };
  const read = await readKeptSkill(home, skill);
  if (read.skill === undefined) return { refused: (read.problems ?? []).join(' ') };
  if (read.held === undefined)
    return { refused: `${name} is not held, so there is nothing to accept.` };
  const accept = { name, version: skill.current, digest: read.digest };
  if (read.held.signed)
    return propose(
      home,
      { accept },
      {
        rationale: `Accept ${name} ${skill.current}, which now also ${read.held.gained.join(', ')}`,
        now,
      },
    );
  return applySkillsChange(home, { accept }, now);
}

/** An older accepted version handed out again; proposed where it reaches further than the current one. */
export async function rollbackSkill(
  home: string,
  name: string,
  version: string,
  now: Date,
): Promise<SkillsChanged> {
  const skill = skillNamed(await readSkillsHub(home), name);
  if (skill === undefined) return { refused: `The hub has no skill named ${name}.` };
  if (skill.scope !== SKILL_SCOPE.PERSONAL)
    return {
      refused: `${name} lives in its repository, so an older version comes back from its history there.`,
    };
  const record = skill.accepted.find((each) => each.version === version);
  if (record === undefined)
    return { refused: `${name} has no accepted version ${version}.` };
  const rollback = { name, version, digest: record.digest };
  const standing = skillStandingOf(skill, record);
  if (standing.widened)
    return propose(
      home,
      { rollback },
      {
        rationale: `Hand out ${name} ${version} again, which also ${standing.gained.join(', ')}`,
        now,
      },
    );
  return applySkillsChange(home, { rollback }, now);
}

/** Giving a skill to an agent is proposed; taking it away is done at once. */
export async function assignSkill(
  home: string,
  input: { name: string; agent: string; project?: string; on: boolean },
  now: Date,
): Promise<SkillsChanged> {
  const hub = await readSkillsHub(home);
  const skill = skillNamed(hub, input.name);
  if (skill === undefined)
    return { refused: `The hub has no skill named ${input.name}.` };
  if (!takesSkills(input.agent))
    return { refused: `Memnox writes no skill format for ${input.agent} yet.` };
  const assignment = {
    agent: input.agent,
    ...(input.project === undefined ? {} : { project: input.project }),
  };
  if (input.on) {
    const where = input.project === undefined ? '' : ` in ${input.project}`;
    return propose(
      home,
      { assign: { name: input.name, ...assignment } },
      { rationale: `Give the skill ${input.name} to ${input.agent}${where}`, now },
    );
  }
  return {
    synced: await syncSkills(
      home,
      withSkill(hub, withSkillAssignment(skill, assignment, false)),
      now,
    ),
  };
}

/** Removing takes a skill out of the hub and every agent at once, and a personal one's kept versions with it. */
export async function removeSkill(
  home: string,
  name: string,
  now: Date,
): Promise<SkillsChanged> {
  const hub = await readSkillsHub(home);
  const skill = skillNamed(hub, name);
  if (skill === undefined) return { refused: `The hub has no skill named ${name}.` };
  const synced = await syncSkills(home, withoutSkill(hub, name), now);
  // A project skill's folder is in the repository, which is the person's to change, not the hub's.
  if (skill.scope === SKILL_SCOPE.PERSONAL)
    await rm(personalSkillDirFor(home, name), { recursive: true, force: true });
  return { synced };
}

/** Disabling takes a skill out of every agent at once; enabling hands back what was signed and accepted. */
export async function setSkillEnabled(
  home: string,
  name: string,
  enabled: boolean,
  now: Date,
): Promise<SkillsChanged> {
  const hub = await readSkillsHub(home);
  const skill = skillNamed(hub, name);
  if (skill === undefined) return { refused: `The hub has no skill named ${name}.` };
  return { synced: await syncSkills(home, withSkill(hub, { ...skill, enabled }), now) };
}

/** A signed change carried out, checked again against the folder, since the folder may have moved since. */
export async function applySkillsChange(
  home: string,
  change: SkillsChange,
  now: Date,
): Promise<SkillsChanged> {
  const hub = await readSkillsHub(home);
  const name = nameOf(change);
  const skill = skillNamed(hub, name);
  if (skill === undefined) return { refused: `The hub has no skill named ${name}.` };
  if ('assign' in change) {
    const { name: _name, ...assignment } = change.assign;
    const assigned = withSkillAssignment(skill, assignment, true);
    return { synced: await syncSkills(home, withSkill(hub, assigned), now) };
  }
  const { version, digest } = 'accept' in change ? change.accept : change.rollback;
  const target = { ...skill, current: version, updatedAt: now.toISOString() };
  const read = await readKeptSkill(home, target);
  if (read.skill === undefined || read.digest !== digest)
    return {
      refused: `${name} ${version} changed after it was proposed, so it was not accepted.`,
    };
  const record = {
    version,
    digest,
    tools: read.skill.manifest.tools,
    reaches: read.reaches,
    acceptedAt: now.toISOString(),
  };
  return {
    synced: await syncSkills(home, withSkill(hub, withAccepted(target, record)), now),
  };
}

function nameOf(change: SkillsChange): string {
  if ('accept' in change) return change.accept.name;
  return 'assign' in change ? change.assign.name : change.rollback.name;
}

async function propose(
  home: string,
  skills: SkillsChange,
  { rationale, now }: { rationale: string; now: Date },
): Promise<SkillsChanged> {
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.SKILLS_HUB, skills },
    rationale,
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { proposed: proposal.id };
}
