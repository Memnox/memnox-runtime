import { DECISION_EFFECT } from '../constants/decision.constants';
import type { DiscoveredAgentKind } from '../discovery/discovery.constants';
import {
  DEFINITION_KIND,
  GRANT,
  quarantined,
  reachOf,
  reviewSkills,
  SKILL_STANDING,
  type AcceptedSkill,
  type DiscoveredSkill,
  type SkillStanding,
} from '../discovery/skills';
import type { RuleDraftInput } from '../daemon/policies';
import { compareVersions, type CanonicalSkill, type SkillScope } from './skill';

/**
 * The Skills Hub: skills kept once and handed to the agents a person chose. A skill whose folder
 * no longer matches what somebody accepted is held, and handed out only once it is accepted again.
 */

export const SKILLS_HUB_VERSION = 1;

/** A version somebody accepted, kept so a later one is compared with it and an older one can come back. */
export interface AcceptedSkillVersion {
  version: string;
  digest: string;
  tools: string[];
  /** Command line tools its text names, which is evidence of what it runs. */
  reaches: string[];
  acceptedAt: string;
}

/** Where a skill is handed to one agent: the home folder, or one repository. */
export interface SkillAssignment {
  agent: DiscoveredAgentKind;
  project?: string;
}

export interface HubSkill {
  name: string;
  scope: SkillScope;
  /** On a project skill: the repository it lives in. */
  project?: string;
  /** The version handed out. */
  current: string;
  enabled: boolean;
  /** Oldest first. */
  accepted: AcceptedSkillVersion[];
  assignments: SkillAssignment[];
  updatedAt: string;
}

/** What the hub last wrote for one skill in one agent, so only its own files are ever touched again. */
export interface SkillWritten {
  skill: string;
  agent: DiscoveredAgentKind;
  /** The home folder or the repository it was written under. */
  root: string;
  /** Relative to the root: the folder, or the one file. */
  path: string;
  /** On a folder: every file in it that is ours, relative to it. */
  files?: string[];
  markerFile?: string;
}

export interface SkillsHub {
  version: typeof SKILLS_HUB_VERSION;
  skills: HubSkill[];
  written: SkillWritten[];
}

/** A widening change the person signs before it holds. */
export type SkillsChange =
  | { accept: { name: string; version: string; digest: string } }
  | { assign: { name: string } & SkillAssignment }
  | { rollback: { name: string; version: string; digest: string } };

export function emptySkillsHub(): SkillsHub {
  return { version: SKILLS_HUB_VERSION, skills: [], written: [] };
}

export function skillNamed(hub: SkillsHub, name: string): HubSkill | undefined {
  return hub.skills.find((skill) => skill.name === name);
}

/** The hub with this skill added or replaced by name. */
export function withSkill(hub: SkillsHub, skill: HubSkill): SkillsHub {
  return {
    ...hub,
    skills: [...hub.skills.filter((each) => each.name !== skill.name), skill],
  };
}

/** The hub without the skill of this name, which takes it out of every agent at its next sync. */
export function withoutSkill(hub: SkillsHub, name: string): SkillsHub {
  return { ...hub, skills: hub.skills.filter((each) => each.name !== name) };
}

/** The skill with one assignment on or off; on twice is the same as once. */
export function withSkillAssignment(
  skill: HubSkill,
  assignment: SkillAssignment,
  on: boolean,
): HubSkill {
  const others = skill.assignments.filter(
    (each) => !(each.agent === assignment.agent && each.project === assignment.project),
  );
  return { ...skill, assignments: on ? [...others, assignment] : others };
}

/** The skill with this version recorded as accepted, replacing an earlier record of the same version. */
export function withAccepted(skill: HubSkill, accepted: AcceptedSkillVersion): HubSkill {
  const others = skill.accepted.filter((each) => each.version !== accepted.version);
  return {
    ...skill,
    accepted: [...others, accepted].sort((a, b) => compareVersions(a.version, b.version)),
  };
}

/** What a skill's folder holds now, against the version last accepted. */
export interface SkillStandingNow {
  standing: SkillStanding;
  /** Tools and commands it reaches now that the accepted version did not. */
  gained: string[];
  widened: boolean;
}

/**
 * Read through the same review a found skill gets: unchanged is known, a change is held, and a
 * change that reaches further is the one that needs a signature to accept.
 */
export function skillStandingOf(
  skill: HubSkill,
  now: { digest: string; tools: string[]; reaches: string[] },
): SkillStandingNow {
  const before =
    skill.accepted.find((each) => each.version === skill.current) ??
    skill.accepted.at(-1);
  const found: DiscoveredSkill = {
    id: skill.name,
    name: skill.name,
    path: skill.name,
    agent: 'memnox',
    kind: DEFINITION_KIND.SKILL,
    grant: { kind: GRANT.DECLARED, tools: now.tools },
    reaches: now.reaches,
    digest: now.digest,
  };
  const accepted: AcceptedSkill[] =
    before === undefined ? [] : [acceptedRecordOf(skill.name, before)];
  const [finding] = reviewSkills([found], accepted);
  if (finding === undefined)
    return { standing: SKILL_STANDING.NEW, gained: [], widened: false };
  const gained = [
    ...finding.gained,
    ...now.tools.filter((tool) => before !== undefined && !before.tools.includes(tool)),
  ];
  return {
    standing: finding.standing,
    gained: finding.standing === SKILL_STANDING.NEW ? [] : gained,
    widened: quarantined([finding]).length > 0,
  };
}

function acceptedRecordOf(name: string, version: AcceptedSkillVersion): AcceptedSkill {
  return {
    id: name,
    digest: version.digest,
    reaches: version.reaches,
    acceptedAt: version.acceptedAt,
    acceptedBy: 'memnox',
    grant: { kind: GRANT.DECLARED, tools: version.tools },
  };
}

/** What a skill's text names, read the way a found skill is read. */
export function reachesOf(skill: CanonicalSkill, binaries: readonly string[]): string[] {
  const texts = [
    skill.instructions,
    ...skill.files.map((file) => Buffer.from(file.bytes).toString('utf8')),
  ];
  return reachOf(texts.join('\n'), binaries);
}

/**
 * What a skill declares it needs, as rules a person signs for the agents it is given to. A skill
 * is instructions rather than a boundary, so what it does beyond these is ruled on as usual.
 */
export function needsOf(
  skill: CanonicalSkill,
  agents: readonly string[],
): RuleDraftInput[] {
  const { name, mcpServers, permissions } = skill.manifest;
  const reason = `the skill ${name} declares it needs this`;
  const scoped = { effect: DECISION_EFFECT.ALLOW, reason, agents: [...agents] };
  return [
    ...permissions.commands.map((command) => ({ ...scoped, action: `${command}.*` })),
    ...mcpServers.map((server) => ({ ...scoped, action: `mcp.${server}.*` })),
    ...permissions.network.map((host) => ({
      ...scoped,
      action: 'http.request',
      targets: [host],
    })),
    ...permissions.filesystem.map((path) => ({
      ...scoped,
      action: 'filesystem.*',
      targets: [path],
    })),
  ];
}
