import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MEMNOX_HOME,
  MOST_RULE_PACK_CHARS,
  readJsonFile,
  writeJsonFile,
  type ProfileDraft,
  type ProfileRulePack,
} from '@memnox/core';

/**
 * Profiles as this machine keeps them, one JSON file each under `~/.memnox/profiles/`. A profile
 * names what it bundles and grants nothing by being kept: only applying it raises proposals.
 */

const PROFILES_DIR = 'profiles';
const PROFILE_VERSION = 1;
const JSON_SUFFIX = '.json';
const MOST_NAME_CHARS = 80;
const MOST_DESCRIPTION_CHARS = 500;
/** Past what any one person bundles, so a hand written file cannot make a screen draw for ever. */
const MOST_NAMES = 100;
const MOST_ID_CHARS = 64;

export interface StoredProfile {
  version: typeof PROFILE_VERSION;
  id: string;
  name: string;
  description?: string;
  skills: string[];
  mcpServers: string[];
  rulePack?: ProfileRulePack;
  updatedAt: string;
}

function profilesDirFor(home: string): string {
  return join(home, MEMNOX_HOME, PROFILES_DIR);
}

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
  if (problems.length > 0) return { problems };
  return {
    profile: {
      version: PROFILE_VERSION,
      id: profileIdOf(name),
      name,
      ...(description === undefined ? {} : { description }),
      skills,
      mcpServers,
      ...(rulePack === undefined ? {} : { rulePack }),
      updatedAt: at,
    },
  };
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
