import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  isProjectId,
  minutesToMs,
  projectIdOf,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  readProjectState,
  readSkillsHub,
  writeProjectState,
  type ProjectApplySummary,
  type ProjectChange,
  type ProjectManifest,
  type ProjectState,
} from '@memnox/core';
import { wrapProjectServers } from '../mcp/wrap-servers';
import { readRegisteredFiles } from '../policy-path';
import { grantsWanted } from './project-grants';
import { handInstructions, readInstructionSources } from './project-instructions';
import { projectAgents, projectPlaces, readProject, rootOf } from './project-places';

/**
 * Opening and applying a project. Its instructions are handed to its agents at once, since they
 * only say what the repository already says; its servers, skills and rule file reach further, so
 * they are one proposal the person signs.
 */

export type ProjectChanged =
  { applied: ProjectApplySummary; id: string; proposed?: string } | { refused: string };

/** Who the card names as having proposed it: the project, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-projects';
const PROPOSAL_TTL_MS = minutesToMs(5);

/** A folder taken in as a project, remembered on this machine, and applied. */
export async function openProject(
  home: string,
  path: string,
  now: Date,
): Promise<ProjectChanged> {
  const root = rootOf(path);
  if (root === null)
    return { refused: `${path} is not inside a repository on this computer.` };
  const id = projectIdOf(root);
  const before = await readProjectState(home, id);
  if (before === null)
    await writeProjectState(home, { id, root, openedAt: now.toISOString(), written: [] });
  return applyProject(home, id, now);
}

/** The project's id from a screen, and the repository it is this machine's record of. */
async function projectRootOf(home: string, id: string): Promise<string | null> {
  if (!isProjectId(id)) return null;
  const state = await readProjectState(home, id);
  if (state !== null) return state.root;
  const place = (await projectPlaces(home)).find((each) => projectIdOf(each.root) === id);
  return place === undefined ? null : place.root;
}

/** Instructions handed out at once; servers, skills and the rule file proposed where they reach further. */
export async function applyProject(
  home: string,
  id: string,
  now: Date,
): Promise<ProjectChanged> {
  const root = await projectRootOf(home, id);
  if (root === null) return { refused: `There is no project ${id} on this computer.` };
  const read = await readProject(root);
  if (read.problems !== undefined) return { refused: read.problems.join(' ') };
  const place = (await projectPlaces(home)).find((each) => each.root === root);
  const agents = projectAgents(read.manifest, place === undefined ? [] : place.hosts);
  const handed = await handOut(home, { id, root, manifest: read.manifest, agents }, now);
  const grants = grantsWanted(await readHub(home), await readSkillsHub(home), {
    manifest: read.manifest,
    root,
    agents,
  });
  const policy = await policyToRegister(home, root, read.manifest.policy);
  const applied: ProjectApplySummary = {
    ...handed,
    governed: await wrapProjectServers(home, root),
    missing: grants.missing,
  };
  const change: ProjectChange = {
    projectId: id,
    root,
    servers: grants.servers,
    skills: grants.skills,
    ...(policy === undefined ? {} : { policy }),
  };
  if (!widens(change)) return { applied, id };
  const proposed = await propose(home, change, { name: read.manifest.name, now });
  return { applied, id, proposed };
}

/** The instructions written, and this machine's record of the project kept with what is now ours. */
async function handOut(
  home: string,
  project: { id: string; root: string; manifest: ProjectManifest; agents: string[] },
  now: Date,
): Promise<Pick<ProjectApplySummary, 'written' | 'removed' | 'kept'>> {
  const { id, root } = project;
  const state = (await readProjectState(home, id)) ?? newState(id, root, now);
  const handed = await handInstructions(
    home,
    {
      root,
      agents: project.agents,
      sources: await readInstructionSources(root, project.manifest.instructions),
      previous: state.written,
    },
    now,
  );
  await writeProjectState(home, {
    ...state,
    appliedAt: now.toISOString(),
    written: handed.ours,
  });
  return { written: handed.written, removed: handed.removed, kept: handed.kept };
}

function newState(id: string, root: string, now: Date): ProjectState {
  return { id, root, openedAt: now.toISOString(), written: [] };
}

/** The rule file, absolute, where it is there and not already in force; a file outside the repository never is. */
async function policyToRegister(
  home: string,
  root: string,
  file: string | undefined,
): Promise<string | undefined> {
  if (file === undefined) return undefined;
  const path = join(root, file);
  if (!isInside(root, path) || !existsSync(path)) return undefined;
  const registered = await readRegisteredFiles(home);
  return registered.includes(path) ? undefined : path;
}

export function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}

function widens(change: ProjectChange): boolean {
  return change.servers.length + change.skills.length > 0 || change.policy !== undefined;
}

/** What the card says it hands over, counted. */
function rationaleOf(change: ProjectChange, name: string): string {
  const parts = [
    counted(change.servers.length, 'server grant'),
    counted(change.skills.length, 'skill grant'),
    change.policy === undefined ? '' : 'its rule file',
  ].filter((part) => part !== '');
  return `Open ${name} with ${parts.join(', ')} for the agents that work in it`;
}

function counted(count: number, noun: string): string {
  if (count === 0) return '';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function propose(
  home: string,
  project: ProjectChange,
  { name, now }: { name: string; now: Date },
): Promise<string> {
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.PROJECT, project },
    rationale: rationaleOf(project, name),
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return proposal.id;
}
