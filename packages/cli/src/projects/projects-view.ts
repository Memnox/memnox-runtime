import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentQuestions,
  INSTRUCTION_MARKERS,
  INSTRUCTION_TARGETS,
  isOurs,
  loadPoliciesFromFile,
  Missions,
  projectIdOf,
  readHub,
  readSkillsHub,
  type Hub,
  type Mission,
  type ProfileBindings,
  type ProjectInstructionView,
  type ProjectMissionView,
  type ProjectRulesView,
  type ProjectsView,
  type ProjectView,
  type SkillsHub,
  type AgentQuestion,
  PROJECT_SCOPE,
} from '@memnox/core';
import { readBindings } from '../agents/connections';
import { readRegisteredFiles } from '../policy-path';
import { serverGrantViews, skillGrantViews } from './project-grants';
import {
  organizationView,
  readOrgOverlay,
  sharedProjectAt,
  type OrgOverlay,
} from './project-organization';
import {
  agentsSeen,
  projectAgents,
  projectPlaces,
  readProject,
  type ProjectPlace,
} from './project-places';

/**
 * Every project as a screen draws it: the agents seen in it and its sessions, what it gives them,
 * its rules and instruction files, and the work still open there. Most recently active first.
 */

/** Read once per answer, so every project in it is drawn against the same hubs and the same rules. */
interface Shared {
  hub: Hub;
  skillsHub: SkillsHub;
  registered: string[];
  missions: Mission[];
  questions: AgentQuestion[];
  overlay: OrgOverlay;
  bindings: ProfileBindings;
}

export async function readProjectsView(home: string, now: Date): Promise<ProjectsView> {
  const [places, hub, skillsHub, registered, missions, questions, overlay, bindings] =
    await Promise.all([
      projectPlaces(home),
      readHub(home),
      readSkillsHub(home),
      readRegisteredFiles(home),
      new Missions(home).all(),
      new AgentQuestions(home).open(now.toISOString()),
      readOrgOverlay(home),
      readBindings(home),
    ]);
  const shared = { hub, skillsHub, registered, missions, questions, overlay, bindings };
  const projects = await Promise.all(places.map((place) => projectView(place, shared)));
  return {
    projects: projects.sort((a, b) =>
      (b.lastActive ?? '').localeCompare(a.lastActive ?? ''),
    ),
  };
}

async function projectView(place: ProjectPlace, shared: Shared): Promise<ProjectView> {
  const { root, hosts, state } = place;
  const read = await readProject(root);
  const agents = projectAgents(read.manifest, hosts, shared.bindings);
  const input = { manifest: read.manifest, root, agents };
  const sessions = new Set(hosts.map((host) => host.sessionId));
  const lastActive = lastActiveOf(place);
  const org = organizationAt(root, shared);
  return {
    id: projectIdOf(root),
    ...org,
    name: read.manifest.name,
    path: root,
    declared: read.declared,
    ...(read.problems === undefined ? {} : { problems: read.problems }),
    opened: state !== null,
    agents,
    agentsSeen: agentsSeen(hosts),
    sessions: {
      total: sessions.size,
      ended: hosts.filter((host) => host.endedAt !== undefined).length,
    },
    servers: serverGrantViews(shared.hub, input),
    skills: skillGrantViews(shared.skillsHub, input),
    rules: await rulesView(root, read.manifest.policy, shared.registered),
    instructions: await instructionViews(root, read.manifest.instructions),
    memoryScope:
      org.organization === undefined ? read.manifest.memory : org.organization.memory,
    openMissions: openMissionsIn(shared.missions, root),
    openQuestions: shared.questions.filter((question) => sessions.has(question.sessionId))
      .length,
    ...(lastActive === undefined ? {} : { lastActive }),
    ...(state === null || state.appliedAt === undefined
      ? {}
      : { appliedAt: state.appliedAt }),
  };
}

/** The organization's read only scope over this clone, where Memnox Cloud shares its repository. */
function organizationAt(
  root: string,
  shared: Shared,
): Pick<ProjectView, 'scope' | 'organization'> {
  const project = sharedProjectAt(root, shared.overlay.projects);
  if (project === undefined) return {};
  return {
    scope: PROJECT_SCOPE.ORGANIZATION,
    organization: organizationView(project, shared.overlay),
  };
}

/** The latest moment anything happened in the project: a session seen, or the project opened or applied. */
function lastActiveOf({ hosts, state }: ProjectPlace): string | undefined {
  return [state?.appliedAt, state?.openedAt, ...hosts.map((host) => host.seenAt)]
    .filter((at): at is string => at !== undefined)
    .sort()
    .pop();
}

function openMissionsIn(
  missions: readonly Mission[],
  root: string,
): ProjectMissionView[] {
  return missions
    .filter((mission) => mission.closedAt === undefined && mission.root === root)
    .map(({ id, statement, startedAt }) => ({ id, statement, startedAt }));
}

async function rulesView(
  root: string,
  file: string | undefined,
  registered: readonly string[],
): Promise<ProjectRulesView> {
  if (file === undefined) return { count: 0, inForce: false };
  const path = join(root, file);
  const base = { file, inForce: registered.includes(path) };
  if (!existsSync(path)) return { ...base, count: 0, problem: `${file} is not there.` };
  try {
    return { ...base, count: (await loadPoliciesFromFile(path)).length };
  } catch (err) {
    return {
      ...base,
      count: 0,
      problem: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The sources the project reads and the files its agents read, each once, with what is ours in each. */
async function instructionViews(
  root: string,
  sources: readonly string[],
): Promise<ProjectInstructionView[]> {
  const paths = [
    ...new Set([...sources, ...INSTRUCTION_TARGETS.map((target) => target.path)]),
  ];
  const views = await Promise.all(
    paths.map(async (path): Promise<ProjectInstructionView> => {
      const text = await readFile(join(root, path), 'utf8').catch(
        // Not there is an answer the view gives, rather than a failure.
        (): string | null => null,
      );
      return {
        path,
        source: sources.includes(path),
        present: text !== null,
        agents: INSTRUCTION_TARGETS.filter((target) => target.path === path).map(
          (target) => target.agent,
        ),
        written:
          text !== null && (text.includes(INSTRUCTION_MARKERS.begin) || isOurs(text)),
      };
    }),
  );
  return views.filter((view) => view.source || view.present);
}
