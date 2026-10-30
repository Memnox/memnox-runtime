/**
 * A skill as Memnox keeps it, once, before it is written into any agent's own format: its
 * instructions, the files beside them, and a manifest saying what it needs and what it is.
 */

/**
 * Whose a skill is: the person's, under the Memnox home, a repository's, committed with it, or the
 * organization's, pulled with the bundle and never changed on this machine.
 */
export const SKILL_SCOPE = {
  PERSONAL: 'personal',
  PROJECT: 'project',
  ORGANIZATION: 'organization',
} as const;

export type SkillScope = (typeof SKILL_SCOPE)[keyof typeof SKILL_SCOPE];

/** The instructions every agent format starts from. */
export const SKILL_INSTRUCTIONS = 'SKILL.md';

/** The manifest, kept beside the instructions and left out of the folder digest it states. */
export const SKILL_MANIFEST = 'skill.toml';

/** What a skill says it needs to do its work, each a list of patterns. */
export interface SkillPermissions {
  /** Paths it reads or writes outside its working folder. */
  filesystem: string[];
  /** Hosts it reaches. */
  network: string[];
  /** Command line tools it runs, by binary. */
  commands: string[];
}

export interface SkillManifest {
  name: string;
  version: string;
  publisher?: string;
  description: string;
  category?: string;
  /** The folder digest the publisher stated; what holds a skill is the digest somebody accepted. */
  digest: string;
  /** Other skills it builds on, by name. */
  dependencies: string[];
  /** MCP servers it calls, by name. */
  mcpServers: string[];
  /** The agent tools it is granted, such as Bash or Read. */
  tools: string[];
  permissions: SkillPermissions;
  /** The agents it was written for, by kind; empty is any. */
  agents: string[];
}

/** One file beside the instructions, by its path inside the skill folder. */
export interface SkillFile {
  path: string;
  bytes: Uint8Array;
}

export interface CanonicalSkill {
  manifest: SkillManifest;
  instructions: string;
  /** Every other file, never the instructions or the manifest. */
  files: SkillFile[];
}

/** Lower case letters, digits and a few separators, so a name is safe as a folder in every agent. */
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Three numbers, and an optional label after them. */
const SKILL_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** As many files as a skill reasonably carries, so a folder cannot fill the disk of every agent. */
export const MOST_SKILL_FILES = 200;
export const MOST_SKILL_BYTES = 4 * 1024 * 1024;

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name);
}

/** A name somebody gave a skill elsewhere, made into one every agent folder takes. */
export function skillNameOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
}

/** A path inside the folder that stays inside it, with no way up and no absolute start. */
export function isInsideFolder(path: string): boolean {
  if (path.includes('\\')) return false;
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Every reason this skill cannot be kept, in the words a form shows; empty when it can. */
export function skillProblems(skill: CanonicalSkill): string[] {
  const { manifest, files } = skill;
  const problems: string[] = [];
  if (!isSkillName(manifest.name))
    problems.push('A name is lower case letters, digits, dots, dashes or underscores.');
  if (!SKILL_VERSION.test(manifest.version))
    problems.push('A version is three numbers, such as 1.0.0.');
  if (manifest.description.trim() === '') problems.push('Say what the skill is for.');
  if (skill.instructions.trim() === '') problems.push('A skill needs its instructions.');
  if (files.length > MOST_SKILL_FILES)
    problems.push(`A skill holds at most ${MOST_SKILL_FILES} files.`);
  const bytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (bytes + skill.instructions.length > MOST_SKILL_BYTES)
    problems.push('A skill is at most 4 MB.');
  for (const file of files) {
    if (!isInsideFolder(file.path) || reserved(file.path))
      problems.push(`${file.path} is not a file name inside the skill.`);
  }
  return problems;
}

function reserved(path: string): boolean {
  return path === SKILL_INSTRUCTIONS || path === SKILL_MANIFEST;
}

/** Ordered by their numbers, so 1.10.0 comes after 1.9.0. */
export function compareVersions(a: string, b: string): number {
  const left = numbersOf(a);
  const right = numbersOf(b);
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

function numbersOf(version: string): number[] {
  return (version.split(/[-+]/)[0] ?? '').split('.').map((part) => Number(part) || 0);
}
