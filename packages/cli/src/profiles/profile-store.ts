import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_PROFILE_VERSION,
  profilesDirFor,
  MOST_RULE_PACK_CHARS,
  readJsonFile,
  writeJsonFile,
  type AgentProfile,
  type ProfileDraft,
  type ProfileJob,
  type ProfileRulePack,
} from '@memnox/core';

/**
 * Profiles as this machine keeps them, one JSON file each under `~/.memnox/profiles/`. A profile
 * names its job and what it bundles and grants nothing by being kept: only applying it proposes.
 */

const JSON_SUFFIX = '.json';
const MOST_NAME_CHARS = 80;
const MOST_DESCRIPTION_CHARS = 500;
/** Past what any one person bundles, so a hand written file cannot make a screen draw for ever. */
const MOST_NAMES = 100;
const MOST_ID_CHARS = 64;
/** Room for a page of standing words, past which they belong in a skill. */
const MOST_INSTRUCTIONS_CHARS = 4000;
const ROLE_PATTERN = new RegExp(`^[A-Za-z0-9._-]{1,${MOST_ID_CHARS}}$`);

/** A version 1 file reads as this with no job set, and is written back as version 2. */
export type StoredProfile = AgentProfile;

/** The name made safe for a file: lower case words joined by a hyphen, as `backend-engineering`. */
function profileIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MOST_ID_CHARS);
}

/** The draft checked whole, or every reason it is not a profile. */
export function profileFrom(
  draft: unknown,
  at: string,
): { profile: StoredProfile } | { problems: string[] } {
  if (typeof draft !== 'object' || draft === null)
    return { problems: ['Send the profile as a name and lists of skills and servers.'] };
  // Cast is safe: every field is checked below before it is kept.
  const raw = draft as Partial<Record<keyof ProfileDraft, unknown>>;
  const problems: string[] = [];
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '' || name.length > MOST_NAME_CHARS || profileIdOf(name) === '')
    problems.push(`A profile has a name of at most ${MOST_NAME_CHARS} characters.`);
  const description = textOf(
    raw.description,
    MOST_DESCRIPTION_CHARS,
    'description',
    problems,
  );
  const skills = namesOf(raw.skills, 'skills', problems);
  const mcpServers = namesOf(raw.mcpServers, 'mcpServers', problems);
  const rulePack = rulePackOf(raw.rulePack, problems);
  const job = profileJobOf(raw, problems);
  if (problems.length > 0) return { problems };
  return {
    profile: {
      version: AGENT_PROFILE_VERSION,
      id: profileIdOf(name),
      name,
      ...(description === undefined ? {} : { description }),
      ...job,
      skills,
      mcpServers,
      ...(rulePack === undefined ? {} : { rulePack }),
      updatedAt: at,
    },
  };
}

/** The job fields, each optional, so a version 1 file reads whole with none of them. */
function profileJobOf(
  raw: Partial<Record<keyof ProfileDraft, unknown>>,
  problems: string[],
): ProfileJob {
  const purpose = textOf(raw.purpose, MOST_DESCRIPTION_CHARS, 'purpose', problems);
  const instructions = textOf(
    raw.instructions,
    MOST_INSTRUCTIONS_CHARS,
    'instructions',
    problems,
  );
  const responsiblePerson = textOf(
    raw.responsiblePerson,
    MOST_NAME_CHARS,
    'responsiblePerson',
    problems,
  );
  const templateOf = textOf(raw.templateOf, MOST_ID_CHARS, 'templateOf', problems);
  const role = roleOf(raw.role, problems);
  return {
    ...(purpose === undefined ? {} : { purpose }),
    ...(role === undefined ? {} : { role }),
    responsibilities: namesOf(raw.responsibilities, 'responsibilities', problems),
    ...(instructions === undefined ? {} : { instructions }),
    ...(responsiblePerson === undefined ? {} : { responsiblePerson }),
    projects: namesOf(raw.projects, 'projects', problems),
    ...(templateOf === undefined ? {} : { templateOf }),
  };
}

/** One word a rule's `roles:` can match, since a role with a space in it could never match one. */
function roleOf(value: unknown, problems: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ROLE_PATTERN.test(value.trim())) {
    problems.push(
      `"role" is one word of at most ${MOST_ID_CHARS} letters, digits, dots, dashes or underscores.`,
    );
    return undefined;
  }
  return value.trim();
}

function textOf(
  value: unknown,
  most: number,
  field: string,
  problems: string[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > most) {
    problems.push(`"${field}" is text of at most ${most} characters.`);
    return undefined;
  }
  return value.trim() === '' ? undefined : value.trim();
}

function namesOf(value: unknown, field: string, problems: string[]): string[] {
  if (value === undefined) return [];
  const names =
    Array.isArray(value) && value.every((each) => typeof each === 'string')
      ? [
          ...new Set(
            value.map((each: string) => each.trim()).filter((each) => each !== ''),
          ),
        ]
      : null;
  if (names === null || names.length > MOST_NAMES) {
    problems.push(`"${field}" is a list of at most ${MOST_NAMES} names.`);
    return [];
  }
  return names;
}

function rulePackOf(value: unknown, problems: string[]): ProfileRulePack | undefined {
  if (value === undefined) return undefined;
  // Cast is safe: both fields are checked to be text before the pack is kept.
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof ProfileRulePack, unknown>
  >;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (
    name === '' ||
    typeof raw.toml !== 'string' ||
    raw.toml.length > MOST_RULE_PACK_CHARS
  ) {
    problems.push('A rule pack is a name and its TOML.');
    return undefined;
  }
  return { name, toml: raw.toml };
}

/** Every profile kept here that still reads as one, by name. */
export async function readProfiles(home: string): Promise<StoredProfile[]> {
  const files = await readdir(profilesDirFor(home)).catch(
    // No folder yet is no profile made yet.
    (): string[] => [],
  );
  const read = await Promise.all(
    files
      .filter((file) => file.endsWith(JSON_SUFFIX))
      .map((file) => readProfileFile(join(profilesDirFor(home), file))),
  );
  return read
    .filter((profile): profile is StoredProfile => profile !== null)
    .sort((one, two) => one.name.localeCompare(two.name));
}

async function readProfileFile(path: string): Promise<StoredProfile | null> {
  const stored = await readJsonFile<Partial<StoredProfile>>(path);
  if (stored === null || typeof stored.updatedAt !== 'string') return null;
  const checked = profileFrom(stored, stored.updatedAt);
  // A file that is not a profile any more is left out rather than shown half read.
  return 'profile' in checked ? checked.profile : null;
}

/** The profile a screen named, by its id or its name. */
export async function profileNamed(
  home: string,
  named: string,
): Promise<StoredProfile | undefined> {
  const id = profileIdOf(named);
  return (await readProfiles(home)).find((profile) => profile.id === id);
}

export async function writeProfile(home: string, profile: StoredProfile): Promise<void> {
  await writeJsonFile(join(profilesDirFor(home), `${profile.id}${JSON_SUFFIX}`), profile);
}

/** True where there was one to forget. */
export async function removeProfile(home: string, named: string): Promise<boolean> {
  const profile = await profileNamed(home, named);
  if (profile === undefined) return false;
  await rm(join(profilesDirFor(home), `${profile.id}${JSON_SUFFIX}`), { force: true });
  return true;
}
