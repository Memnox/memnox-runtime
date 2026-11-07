import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import {
  isProjectId,
  parseProjectToml,
  PROJECT_FILE,
  PROJECTS_DIR,
  projectToml,
  type ProjectManifest,
} from './project';

/** The committed manifest in the repository, and this machine's own record of each project beside the Memnox home. */

const STATE_FILE = 'project.json';

/** What this machine keeps of a project and never shares: when it was opened, applied, and what was written. */
export interface ProjectState {
  id: string;
  root: string;
  openedAt: string;
  appliedAt?: string;
  /** Instruction files of ours, relative to the repository, so only they are ever rewritten or removed. */
  written: string[];
}

export type ReadManifest =
  { manifest: ProjectManifest } | { problems: string[] } | { absent: true };

export function projectFilePathFor(root: string): string {
  return join(root, PROJECT_FILE);
}

export function projectStateDirFor(home: string, id: string): string {
  return join(home, MEMNOX_HOME, PROJECTS_DIR, id);
}

export async function readProjectManifest(root: string): Promise<ReadManifest> {
  let text: string;
  try {
    text = await readFile(projectFilePathFor(root), 'utf8');
  } catch {
    // No manifest is the ordinary repository nobody declared yet.
    return { absent: true };
  }
  const parsed = parseProjectToml(text);
  return 'problems' in parsed ? parsed : { manifest: parsed };
}

export async function writeProjectManifest(
  root: string,
  manifest: ProjectManifest,
): Promise<void> {
  const path = projectFilePathFor(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, projectToml(manifest), 'utf8');
}

export function readProjectState(home: string, id: string): Promise<ProjectState | null> {
  if (!isProjectId(id)) return Promise.resolve(null);
  return readJsonFile<ProjectState>(join(projectStateDirFor(home, id), STATE_FILE));
}

export async function writeProjectState(
  home: string,
  state: ProjectState,
): Promise<void> {
  await writeJsonFile(join(projectStateDirFor(home, state.id), STATE_FILE), state);
}

/** Every project this machine opened, in no particular order. */
export async function allProjectStates(home: string): Promise<ProjectState[]> {
  const ids = await readdir(join(home, MEMNOX_HOME, PROJECTS_DIR)).catch(
    // No folder yet is no project opened yet.
    (): string[] => [],
  );
  const states = await Promise.all(
    ids.filter(isProjectId).map((id) => readProjectState(home, id)),
  );
  return states.filter((state): state is ProjectState => state !== null);
}
