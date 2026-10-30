import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { canonicalJson } from '../domain/canonical-json';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { takesSkills } from './formats/index';
import {
  isSkillName,
  SKILL_INSTRUCTIONS,
  skillProblems,
  type CanonicalSkill,
} from './skill';

/**
 * The organization's skills, pulled with the workspace bundle and read here as a scope nobody on
 * this machine edits, assigns or removes. Each carries a digest Memnox Cloud computed over its
 * content, and one whose content does not match it is refused before anything of it is written.
 */

/** One skill the organization published; absent agents is every agent that takes skills. */
export interface OrgSkill {
  name: string;
  version: string;
  description: string;
  category?: string;
  publisher?: string;
  /** `sha256:` over `SKILL.md` and every file, sorted by path; see `orgSkillDigest`. */
  digest: string;
  instructions: string;
  files: { path: string; text: string }[];
  tools: string[];
  mcpServers: string[];
  permissions: { filesystem: string[]; network: string[]; commands: string[] };
  agents?: string[];
}

/** A skill the bundle carried and this machine would not keep, and why. */
export interface RefusedOrgSkill {
  name: string;
  version: string;
  reason: string;
}

/** What the pull keeps: the skills that matched their digest, the ones that did not, and when it changed. */
export interface OrgSkills {
  skills: OrgSkill[];
  refused: RefusedOrgSkill[];
  /** When the kept skills last changed; absent before the first pull. */
  updatedAt?: string;
}

/** Written by the bundle pull and never by hand. */
const ORG_SKILLS_FILE = 'org-skills.json';
const DIGEST_PREFIX = 'sha256:';
const NUL = '\u0000';
const UNNAMED = '(unnamed)';

export function orgSkillsPathFor(home: string): string {
  return join(home, MEMNOX_HOME, ORG_SKILLS_FILE);
}

/**
 * Memnox Cloud's digest of a skill: every entry, `SKILL.md` for the instructions and each file by
 * its path, sorted by path in byte order, framed as path, NUL, byte length, NUL, then its bytes.
 * The grant is not in it, since the bundle hash already covers that.
 */
export function orgSkillDigest(
  instructions: string,
  files: readonly { path: string; text: string }[],
): string {
  const entries = [
    { path: SKILL_INSTRUCTIONS, bytes: Buffer.from(instructions, 'utf8') },
    ...files.map((file) => ({ path: file.path, bytes: Buffer.from(file.text, 'utf8') })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${entry.path}${NUL}${entry.bytes.length}${NUL}`);
    hash.update(entry.bytes);
  }
  return `${DIGEST_PREFIX}${hash.digest('hex')}`;
}

/** Every skill the bundle carried, kept only where its digest matches and the hub could write it. */
export function orgSkillsFrom(value: unknown): Pick<OrgSkills, 'skills' | 'refused'> {
  const skills: OrgSkill[] = [];
  const refused: RefusedOrgSkill[] = [];
  if (!Array.isArray(value)) return { skills, refused };
  for (const each of value) {
    const read = orgSkillOf(each);
    if ('reason' in read) {
      refused.push(read);
      continue;
    }
    if (skills.some((skill) => skill.name === read.name)) {
      refused.push({ ...refusalOf(read), reason: 'it is published more than once' });
      continue;
    }
    skills.push(read);
  }
  return { skills, refused };
}

function refusalOf(skill: {
  name: string;
  version: string;
}): Omit<RefusedOrgSkill, 'reason'> {
  return { name: skill.name, version: skill.version };
}

/** One skill whose every field is checked and whose content matches its digest, or why not. */
function orgSkillOf(value: unknown): OrgSkill | RefusedOrgSkill {
  const skill = shapeOf(value);
  if ('reason' in skill) return skill;
  const problems = skillProblems(canonicalOrgSkill(skill));
  if (problems.length > 0) return { ...refusalOf(skill), reason: problems.join(' ') };
  if (orgSkillDigest(skill.instructions, skill.files) !== skill.digest)
    return {
      ...refusalOf(skill),
      reason: 'its content does not match the digest Memnox Cloud published',
    };
  return skill;
}

function shapeOf(value: unknown): OrgSkill | RefusedOrgSkill {
  if (typeof value !== 'object' || value === null)
    return { name: UNNAMED, version: '', reason: 'it is not a skill' };
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { name, version, description, digest, instructions, category, publisher } = raw;
  const named = {
    name: typeof name === 'string' ? name : UNNAMED,
    version: typeof version === 'string' ? version : '',
  };
  if (
    ![name, version, description, digest, instructions].every(
      (each) => typeof each === 'string',
    ) ||
    !isSkillName(named.name)
  )
    return {
      ...named,
      reason: 'it lacks a name, version, description, digest or instructions',
    };
  const content = contentOf(raw);
  if (content === null) return { ...named, reason: 'a list in it is not a list of text' };
  return {
    ...named,
    // Casts are safe: all three were checked to be text above.
    description: description as string,
    ...(typeof category === 'string' ? { category } : {}),
    ...(typeof publisher === 'string' ? { publisher } : {}),
    digest: digest as string,
    instructions: instructions as string,
    ...content,
  };
}

type Content = Pick<
  OrgSkill,
  'files' | 'tools' | 'mcpServers' | 'permissions' | 'agents'
>;

/** The files and lists of a skill, or null where any of them is not what it should be. */
function contentOf(raw: Record<string, unknown>): Content | null {
  const files = filesOf(raw['files']);
  const tools = listOf(raw['tools']);
  const mcpServers = listOf(raw['mcpServers']);
  const permissions = permissionsOf(raw['permissions']);
  const agents = listOf(raw['agents']);
  if (
    files === null ||
    tools === null ||
    mcpServers === null ||
    permissions === null ||
    agents === null
  )
    return null;
  return {
    files,
    tools,
    mcpServers,
    permissions,
    // Only kinds that take skills; a name it does not know is an agent it cannot write for.
    ...(raw['agents'] === undefined ? {} : { agents: agents.filter(takesSkills) }),
  };
}

function listOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? [...value]
    : null;
}

function filesOf(value: unknown): OrgSkill['files'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const files: OrgSkill['files'] = [];
  for (const each of value) {
    if (typeof each !== 'object' || each === null) return null;
    // Cast is safe: both fields are checked to be text before either is kept.
    const { path, text } = each as Record<string, unknown>;
    if (typeof path !== 'string' || typeof text !== 'string') return null;
    files.push({ path, text });
  }
  return files;
}

function permissionsOf(value: unknown): OrgSkill['permissions'] | null {
  if (value === undefined) return { filesystem: [], network: [], commands: [] };
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: each list in it is checked below.
  const raw = value as Record<string, unknown>;
  const filesystem = listOf(raw['filesystem']);
  const network = listOf(raw['network']);
  const commands = listOf(raw['commands']);
  if (filesystem === null || network === null || commands === null) return null;
  return { filesystem, network, commands };
}

/** The skill as the hub's formats translate it, with the organization's digest stated. */
export function canonicalOrgSkill(skill: OrgSkill): CanonicalSkill {
  return {
    manifest: {
      name: skill.name,
      version: skill.version,
      description: skill.description,
      ...(skill.category === undefined ? {} : { category: skill.category }),
      ...(skill.publisher === undefined ? {} : { publisher: skill.publisher }),
      digest: skill.digest,
      dependencies: [],
      mcpServers: [...skill.mcpServers],
      tools: [...skill.tools],
      permissions: { ...skill.permissions },
      agents: [...(skill.agents ?? [])],
    },
    instructions: skill.instructions,
    files: skill.files.map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.text, 'utf8'),
    })),
  };
}

/**
 * The skills last pulled, each checked against its digest again as it is read, so a file changed
 * on this machine since the pull is refused rather than written into an agent.
 */
export async function readOrgSkills(home: string): Promise<OrgSkills> {
  const stored = await readJsonFile<Partial<OrgSkills>>(orgSkillsPathFor(home));
  if (stored === null) return { skills: [], refused: [] };
  const read = orgSkillsFrom(stored.skills);
  const refused = Array.isArray(stored.refused) ? stored.refused : [];
  return {
    skills: read.skills,
    refused: [...refused, ...read.refused],
    ...(typeof stored.updatedAt === 'string' ? { updatedAt: stored.updatedAt } : {}),
  };
}

/** Kept for the hub to read; true when they differ from what was kept, so a caller syncs only then. */
export async function writeOrgSkills(
  home: string,
  carried: Pick<OrgSkills, 'skills' | 'refused'>,
  now: Date,
): Promise<boolean> {
  const before = await readOrgSkills(home);
  const same =
    canonicalJson(before.skills) === canonicalJson(carried.skills) &&
    canonicalJson(before.refused) === canonicalJson(carried.refused);
  if (same) return false;
  const kept: OrgSkills = { ...carried, updatedAt: now.toISOString() };
  await writeJsonFile(orgSkillsPathFor(home), kept);
  return true;
}

/** Whether the organization holds a skill by this name, which nothing on this machine may change. */
export function isOrgSkill(org: readonly OrgSkill[], name: string): boolean {
  return org.some((skill) => skill.name === name);
}

/** What a screen is told when it reaches for a skill only the organization changes. */
export function orgSkillOwned(name: string): string {
  return `${name} is the organization's skill, so it is changed in Memnox Cloud rather than here.`;
}
