import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { folderDigest } from './folder-digest';
import { emptySkillsHub, SKILLS_HUB_VERSION, type SkillsHub } from './hub';
import { manifestToml, parseManifest } from './manifest';
import {
  compareVersions,
  MOST_SKILL_BYTES,
  MOST_SKILL_FILES,
  SKILL_INSTRUCTIONS,
  SKILL_MANIFEST,
  SKILL_SCOPE,
  type CanonicalSkill,
  type SkillFile,
  type SkillScope,
} from './skill';

/**
 * The Skills Hub on disk: the hub file, and each skill's own folder. A personal skill keeps every
 * version under `~/.memnox/skills/<name>/<version>`; a project skill is one folder in its repository.
 */

export const SKILLS_HUB_FILE = 'skills-hub.json';
const SKILLS_DIR = 'skills';

/** What a skill folder read as: the skill, and the digest of its folder as it is now. */
export type ReadSkill =
  { skill: CanonicalSkill; digest: string } | { problems: string[] };

export function skillsHubPathFor(home: string): string {
  return join(home, MEMNOX_HOME, SKILLS_HUB_FILE);
}

/** The hub as last written; empty before anything was kept, or when the file will not read as one. */
export async function readSkillsHub(home: string): Promise<SkillsHub> {
  const parsed = await readJsonFile<Partial<SkillsHub>>(skillsHubPathFor(home));
  if (parsed === null || parsed.version !== SKILLS_HUB_VERSION) return emptySkillsHub();
  return {
    version: SKILLS_HUB_VERSION,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    written: Array.isArray(parsed.written) ? parsed.written : [],
  };
}

export async function writeSkillsHub(home: string, hub: SkillsHub): Promise<void> {
  await writeJsonFile(skillsHubPathFor(home), hub);
}

export interface SkillPlace {
  name: string;
  scope: SkillScope;
  version: string;
  project?: string;
}

/** Where a skill's canonical folder is. */
export function skillDirFor(home: string, place: SkillPlace): string {
  if (place.scope === SKILL_SCOPE.PROJECT && place.project !== undefined)
    return join(place.project, MEMNOX_HOME, SKILLS_DIR, place.name);
  return join(home, MEMNOX_HOME, SKILLS_DIR, place.name, place.version);
}

/** The folder every kept version of a personal skill sits in. */
export function personalSkillDirFor(home: string, name: string): string {
  return join(home, MEMNOX_HOME, SKILLS_DIR, name);
}

/** Every version of a personal skill kept here, oldest first. */
export async function personalVersions(home: string, name: string): Promise<string[]> {
  const listed = await readdir(personalSkillDirFor(home, name)).catch(
    // No folder yet is a skill with no versions kept.
    (): string[] => [],
  );
  return listed.sort(compareVersions);
}

/** The folder written whole, the manifest stating the digest of everything else; the digest written. */
export async function writeCanonicalSkill(
  dir: string,
  skill: CanonicalSkill,
): Promise<string> {
  const digest = folderDigest(skill);
  // The folder is the hub's own copy, so a file an earlier version held is not left behind.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SKILL_INSTRUCTIONS), skill.instructions, 'utf8');
  for (const file of skill.files) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.bytes);
  }
  await writeFile(
    join(dir, SKILL_MANIFEST),
    manifestToml({ ...skill.manifest, digest }),
    'utf8',
  );
  return digest;
}

/** The folder as it is now, read whole and bounded; a folder too big or with no manifest is a problem. */
export async function readCanonicalSkill(dir: string): Promise<ReadSkill> {
  const manifestText = await readFile(join(dir, SKILL_MANIFEST), 'utf8').catch(
    () => null,
  );
  if (manifestText === null) return { problems: [`${dir} has no ${SKILL_MANIFEST}.`] };
  const manifest = parseManifest(manifestText);
  if ('problems' in manifest) return manifest;
  const read = await filesUnder(dir);
  if ('problems' in read) return read;
  const instructions = read.files.find((file) => file.path === SKILL_INSTRUCTIONS);
  if (instructions === undefined)
    return { problems: [`${dir} has no ${SKILL_INSTRUCTIONS}.`] };
  const skill: CanonicalSkill = {
    manifest,
    instructions: Buffer.from(instructions.bytes).toString('utf8'),
    files: read.files.filter(
      (file) => file !== instructions && file.path !== SKILL_MANIFEST,
    ),
  };
  return { skill, digest: folderDigest(skill) };
}

/** Every regular file under the folder, links never followed, stopping once it is bigger than a skill may be. */
export async function filesUnder(
  dir: string,
): Promise<{ files: SkillFile[] } | { problems: string[] }> {
  const files: SkillFile[] = [];
  let bytes = 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
    // A folder that will not list holds nothing this can read.
    () => [],
  );
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (files.length >= MOST_SKILL_FILES + 1)
      return { problems: [`${dir} holds more files than a skill may.`] };
    const path = join(entry.parentPath, entry.name);
    const content = await readFile(path);
    bytes += content.length;
    if (bytes > MOST_SKILL_BYTES)
      return { problems: [`${dir} is bigger than a skill may be.`] };
    files.push({
      path: path
        .slice(dir.length + 1)
        .split('\\')
        .join('/'),
      bytes: content,
    });
  }
  return { files: files.sort((a, b) => (a.path < b.path ? -1 : 1)) };
}
