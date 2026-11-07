import { join } from 'node:path';
import {
  MEMNOX_HOME,
  readJsonFile,
  writeJsonFile,
  type ProfileBinding,
  type ProfileBindings,
} from '@memnox/core';

/**
 * Which profile a person bound to which agent, beside `names.json`. Only a binding is stored:
 * an agent nobody bound answers to its default profile, which is computed and never written.
 */

const AGENTS_DIR = 'agents';
const CONNECTIONS_FILE = 'connections.json';

function connectionsPath(home: string): string {
  return join(home, MEMNOX_HOME, AGENTS_DIR, CONNECTIONS_FILE);
}

export async function readBindings(home: string): Promise<ProfileBindings> {
  const parsed = await readJsonFile<unknown>(connectionsPath(home));
  if (parsed === null || typeof parsed !== 'object') return {};
  const kept: Record<string, ProfileBinding> = {};
  // Narrowed to an object above, and every entry is checked below.
  for (const [agentId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isBinding(value)) kept[agentId] = value;
  }
  return kept;
}

/** A hand edited file is untrusted like any other: keep only what reads as a binding. */
function isBinding(value: unknown): value is ProfileBinding {
  if (typeof value !== 'object' || value === null) return false;
  // Cast is safe: each field is checked to be text on the line below.
  const raw = value as Record<string, unknown>;
  return typeof raw['profileId'] === 'string' && typeof raw['boundAt'] === 'string';
}

export async function bindProfile(
  home: string,
  agentId: string,
  binding: ProfileBinding,
): Promise<void> {
  await writeJsonFile(connectionsPath(home), {
    ...(await readBindings(home)),
    [agentId]: binding,
  });
}

/** True where there was a binding to take off, which puts the agent back on its default. */
export async function unbindProfile(home: string, agentId: string): Promise<boolean> {
  const bindings = await readBindings(home);
  if (bindings[agentId] === undefined) return false;
  const { [agentId]: _dropped, ...rest } = bindings;
  await writeJsonFile(connectionsPath(home), rest);
  return true;
}
