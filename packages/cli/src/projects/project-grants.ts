import {
  DISCOVERED_AGENT_KIND,
  hasServerIn,
  skillNamed,
  takesSkills,
  type DiscoveredAgentKind,
  type Hub,
  type HubAssignment,
  type HubSkill,
  type ProjectGrantView,
  type ProjectManifest,
  type SkillAssignment,
  type SkillsHub,
} from '@memnox/core';
import { takesProjectServers } from '../mcp/project-servers';

/**
 * What a project's servers and skills come to for its agents: what each agent has already, and
 * what opening the project would hand it that it does not, which is what the person signs.
 */

const AGENT_KINDS: readonly string[] = Object.values(DISCOVERED_AGENT_KIND);

interface ProjectGrants {
  servers: HubAssignment[];
  skills: ({ name: string } & SkillAssignment)[];
  /** Names the manifest gives that the hubs here do not hold. */
  missing: string[];
}

interface GrantInput {
  manifest: ProjectManifest;
  root: string;
  agents: readonly string[];
}

function agentKinds(agents: readonly string[]): DiscoveredAgentKind[] {
  // Cast is safe: each is checked against every kind in the same expression.
  return agents.filter((agent) => AGENT_KINDS.includes(agent)) as DiscoveredAgentKind[];
}

/** An agent has a skill here when it is written into this repository for it, or into its home folder. */
function hasSkill(skill: HubSkill, agent: string, root: string): boolean {
  return skill.assignments.some(
    (each) =>
      each.agent === agent && (each.project === undefined || each.project === root),
  );
}

/** Everything the manifest gives that an agent of the project lacks, and every name nothing here holds. */
export function grantsWanted(
  hub: Hub,
  skillsHub: SkillsHub,
  input: GrantInput,
): ProjectGrants {
  const agents = agentKinds(input.agents);
  const grants: ProjectGrants = { servers: [], skills: [], missing: [] };
  for (const server of input.manifest.servers) {
    if (!hub.servers.some((each) => each.name === server)) {
      grants.missing.push(server);
      continue;
    }
    // Given in this repository alone; an agent that reads no per repository config is not given it at all.
    for (const agent of agents.filter(takesProjectServers)) {
      const grant = { server, agent, project: input.root };
      if (!hasServerIn(hub, grant)) grants.servers.push(grant);
    }
  }
  for (const name of input.manifest.skills) {
    const skill = skillNamed(skillsHub, name);
    if (skill === undefined) {
      grants.missing.push(name);
      continue;
    }
    for (const agent of agents.filter(takesSkills))
      if (!hasSkill(skill, agent, input.root))
        grants.skills.push({ name, agent, project: input.root });
  }
  return grants;
}

/** Each server the project names, and which of its agents already have it. */
export function serverGrantViews(hub: Hub, input: GrantInput): ProjectGrantView[] {
  return input.manifest.servers.map((name) => {
    return {
      name,
      inHub: hub.servers.some((each) => each.name === name),
      agents: agentKinds(input.agents).filter((agent) =>
        hasServerIn(hub, { server: name, agent, project: input.root }),
      ),
    };
  });
}

/** Each skill the project names, and which of its agents have it written into this repository. */
export function skillGrantViews(
  skillsHub: SkillsHub,
  input: GrantInput,
): ProjectGrantView[] {
  return input.manifest.skills.map((name) => {
    const skill = skillNamed(skillsHub, name);
    return {
      name,
      inHub: skill !== undefined,
      agents:
        skill === undefined
          ? []
          : input.agents.filter((agent) => hasSkill(skill, agent, input.root)),
    };
  });
}
