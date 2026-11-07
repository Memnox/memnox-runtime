import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { canonicalJson } from '../domain/canonical-json';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { orgProjectsFrom, type OrgProject } from './shared-project';

/** The organization's shared projects as the last bundle pull carried them, written by the pull and never by hand. */

const ORG_PROJECTS_FILE = 'org-projects.json';

export function orgProjectsPathFor(home: string): string {
  return join(home, MEMNOX_HOME, ORG_PROJECTS_FILE);
}

/** The projects last pulled; none before the first pull, or when the file will not read. */
export async function readOrgProjects(home: string): Promise<OrgProject[]> {
  return orgProjectsFrom(await readJsonFile<unknown>(orgProjectsPathFor(home)));
}

/** Kept for every screen and session to read; true when they differ from what was kept. */
export async function writeOrgProjects(
  home: string,
  projects: readonly OrgProject[],
): Promise<boolean> {
  const before = await readOrgProjects(home);
  if (canonicalJson(before) === canonicalJson(projects)) return false;
  await writeJsonFile(orgProjectsPathFor(home), projects);
  return true;
}
