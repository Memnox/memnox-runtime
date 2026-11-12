import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  DISCOVERED_AGENT_KIND,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  readSkillsHub,
  rulesOfPack,
  skillNamed,
  type DiscoveredAgentKind,
  type ProfileApplied,
  type ProfileJob,
  type ProfileView,
} from '@memnox/core';
import { assignSkill } from '../skills/skills-changes';
import { importPack } from '../studio/rule-changes';
import { profileNamed, readProfiles, type StoredProfile } from './profile-store';

/**
 * A profile applied to one agent, in one project: each server and skill it bundles given to that
 * agent and each rule of its pack put in force, every one through the proposal it raises on its
 * own, so applying a profile never widens anything the person did not sign.
 */

/** Who the cards name as having proposed them: the profile, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-profiles';
/** Long enough to read a profile's cards through one by one. */
const PROPOSAL_TTL_MS = minutesToMs(10);
const AGENT_KINDS: readonly string[] = Object.values(DISCOVERED_AGENT_KIND);

interface ApplyInput {
  profile: string;
  agent: string;
  /** The repository its skills are written into and its rules hold in; absent is the home folder and the whole machine. */
  project?: string;
}

export async function applyProfile(
  home: string,
  input: ApplyInput,
  now: Date,
): Promise<ProfileApplied | { refused: string }> {
  const profile = await profileNamed(home, input.profile);
  if (profile === undefined) return { refused: `No profile is called ${input.profile}.` };
  if (!AGENT_KINDS.includes(input.agent))
    return { refused: `${input.agent} is not an agent Memnox knows.` };
  // Cast is safe: checked against every kind on the line before.
  const agent = input.agent as DiscoveredAgentKind;
  if (input.project !== undefined && !(await isFolder(input.project)))
    return { refused: 'Name the project as a folder on this computer.' };
  const applied: ProfileApplied = {
    profile: profile.name,
    agent,
    ...(input.project === undefined ? {} : { project: input.project }),
    proposed: [],
    already: [],
    skipped: [],
  };
  await proposeServers(home, { profile, agent, now }, applied);
  await proposeSkills(home, { profile, agent, now, project: input.project }, applied);
  await proposePack(home, { profile, now, project: input.project }, applied);
  return applied;
}

interface Applying {
  profile: StoredProfile;
  agent: DiscoveredAgentKind;
  now: Date;
}

async function proposeServers(
  home: string,
  { profile, agent, now }: Applying,
  applied: ProfileApplied,
): Promise<void> {
  const hub = await readHub(home);
  for (const server of profile.mcpServers) {
    if (!hub.servers.some((each) => each.name === server)) {
      applied.skipped.push(`${server} is not in the MCP Hub.`);
      continue;
    }
    if (hub.assignments.some((each) => each.server === server && each.agent === agent)) {
      applied.already.push(server);
      continue;
    }
    const proposal = await new Proposals(home).propose({
      change: { kind: PROPOSAL_KIND.MCP_HUB, hub: { assign: { server, agent } } },
      rationale: `Give the MCP server ${server} to ${agent}, from the ${profile.name} profile`,
      proposedBy: PROPOSED_BY,
      at: now.toISOString(),
      ttlMs: PROPOSAL_TTL_MS,
    });
    applied.proposed.push(proposal.id);
  }
}

async function proposeSkills(
  home: string,
  { profile, agent, now, project }: Applying & { project: string | undefined },
  applied: ProfileApplied,
): Promise<void> {
  const hub = await readSkillsHub(home);
  for (const name of profile.skills) {
    const skill = skillNamed(hub, name);
    if (skill === undefined) {
      applied.skipped.push(`${name} is not in the Skills Hub.`);
      continue;
    }
    if (
      skill.assignments.some((each) => each.agent === agent && each.project === project)
    ) {
      applied.already.push(name);
      continue;
    }
    const given = await assignSkill(
      home,
      { name, agent, on: true, ...(project === undefined ? {} : { project }) },
      now,
    );
    if ('proposed' in given) applied.proposed.push(given.proposed);
    else if ('refused' in given) applied.skipped.push(given.refused);
  }
}

/** Named a repository, the pack's rules hold only there; with none they are the person's own, as before. */
async function proposePack(
  home: string,
  { profile, now, project }: Omit<Applying, 'agent'> & { project: string | undefined },
  applied: ProfileApplied,
): Promise<void> {
  const pack = profile.rulePack;
  if (pack === undefined) return;
  const imported = await importPack(home, pack.toml, now.toISOString(), project);
  if ('refused' in imported) applied.skipped.push(`${pack.name}: ${imported.refused}`);
  else applied.proposed.push(...imported.proposed);
}

/** The job fields as a screen shows them, absent ones left out rather than sent empty. */
function jobOf(profile: StoredProfile): ProfileJob {
  const { purpose, role, instructions, responsiblePerson, templateOf } = profile;
  return {
    ...(purpose === undefined ? {} : { purpose }),
    ...(role === undefined ? {} : { role }),
    responsibilities: profile.responsibilities,
    ...(instructions === undefined ? {} : { instructions }),
    ...(responsiblePerson === undefined ? {} : { responsiblePerson }),
    projects: profile.projects,
    ...(templateOf === undefined ? {} : { templateOf }),
  };
}

async function isFolder(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Absent is the person's to fix, and is said as such rather than thrown.
    return false;
  }
}

/** Every kept profile as a screen draws it, each with what the hubs no longer hold said. */
export async function readProfileViews(
  home: string,
): Promise<Omit<ProfileView, 'connections' | 'levels'>[]> {
  const [profiles, hub, skills] = await Promise.all([
    readProfiles(home),
    readHub(home),
    readSkillsHub(home),
  ]);
  return profiles.map((profile) => {
    const pack = profile.rulePack;
    const read = pack === undefined ? undefined : rulesOfPack(pack.toml);
    const missing = missingOf(profile, { hub, skills, read });
    return {
      id: profile.id,
      name: profile.name,
      ...(profile.description === undefined ? {} : { description: profile.description }),
      ...jobOf(profile),
      skills: profile.skills,
      mcpServers: profile.mcpServers,
      ...(pack === undefined
        ? {}
        : {
            rulePack: {
              name: pack.name,
              rules: read !== undefined && 'rules' in read ? read.rules.length : 0,
            },
          }),
      updatedAt: profile.updatedAt,
      missing,
    };
  });
}

/** What a profile names that the hubs no longer hold, or a pack that no longer loads, said. */
function missingOf(
  profile: StoredProfile,
  held: {
    hub: Awaited<ReturnType<typeof readHub>>;
    skills: Awaited<ReturnType<typeof readSkillsHub>>;
    read: ReturnType<typeof rulesOfPack> | undefined;
  },
): string[] {
  const { hub, skills, read } = held;
  const pack = profile.rulePack;
  return [
    ...profile.mcpServers
      .filter((name) => !hub.servers.some((each) => each.name === name))
      .map((name) => `${name} is not in the MCP Hub.`),
    ...profile.skills
      .filter((name) => skillNamed(skills, name) === undefined)
      .map((name) => `${name} is not in the Skills Hub.`),
    ...(pack !== undefined && read !== undefined && 'problems' in read
      ? [`${pack.name} would not load: ${read.problems.join('; ')}`]
      : []),
  ];
}
