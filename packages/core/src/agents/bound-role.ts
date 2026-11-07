import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { readJsonFile } from '../store/json-records';

/**
 * Where this machine keeps which profile a person bound to which agent, and the profiles
 * themselves, so a hook that never went through `memnox run` finds the same role a run would.
 */

const AGENTS_DIR = 'agents';
const CONNECTIONS_FILE = 'connections.json';
const PROFILES_DIR = 'profiles';
const JSON_SUFFIX = '.json';
/** The id a profile is kept under, so a hand edited binding cannot name a path outside. */
const PROFILE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
/** What a profile writer accepts as a role, held again here since the file is hand editable. */
const ROLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function agentBindingsPathFor(home: string): string {
  return join(home, MEMNOX_HOME, AGENTS_DIR, CONNECTIONS_FILE);
}

export function profilesDirFor(home: string): string {
  return join(home, MEMNOX_HOME, PROFILES_DIR);
}

/**
 * The role of the profile bound to this agent, or none where nothing is bound, the profile is
 * gone, or either file does not read as what it should. Never a role the files do not state.
 */
export async function boundRoleOf(
  home: string,
  agentId: string,
): Promise<string | undefined> {
  const profileId = await boundProfileIdOf(home, agentId);
  if (profileId === undefined) return undefined;
  const profile = await readJsonFile<unknown>(
    join(profilesDirFor(home), `${profileId}${JSON_SUFFIX}`),
  );
  if (typeof profile !== 'object' || profile === null) return undefined;
  // Narrowed to an object above, and the one field read is checked below.
  const role = (profile as Record<string, unknown>)['role'];
  return typeof role === 'string' && ROLE_PATTERN.test(role) ? role : undefined;
}

async function boundProfileIdOf(
  home: string,
  agentId: string,
): Promise<string | undefined> {
  const bindings = await readJsonFile<unknown>(agentBindingsPathFor(home));
  if (typeof bindings !== 'object' || bindings === null) return undefined;
  // Narrowed to an object above, and the entry is checked below.
  const binding = (bindings as Record<string, unknown>)[agentId];
  if (typeof binding !== 'object' || binding === null) return undefined;
  // Narrowed to an object above, and the field read is checked on the next line.
  const profileId = (binding as Record<string, unknown>)['profileId'];
  return typeof profileId === 'string' && PROFILE_ID_PATTERN.test(profileId)
    ? profileId
    : undefined;
}
