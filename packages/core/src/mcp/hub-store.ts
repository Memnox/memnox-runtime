import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import type { McpServerHealth } from '../daemon/mcp-hub';
import { emptyHub, HUB_VERSION, type Hub } from './registry';

/** Where the hub is kept: names and references only, since every secret value lives in the OS store. */
const HUB_FILE = 'mcp-hub.json';

/** What each server answered when it was last tested, by name, kept apart since it is rewritten on every test. */
const HEALTH_FILE = 'mcp-health.json';

export function hubPathFor(home: string): string {
  return join(home, MEMNOX_HOME, HUB_FILE);
}

/** The hub as last written; empty when nothing was ever added, or the file will not read as one. */
export async function readHub(home: string): Promise<Hub> {
  const parsed = await readJsonFile<Partial<Hub>>(hubPathFor(home));
  if (parsed === null || parsed.version !== HUB_VERSION) return emptyHub();
  return {
    version: HUB_VERSION,
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    written: Array.isArray(parsed.written) ? parsed.written : [],
  };
}

export async function writeHub(home: string, hub: Hub): Promise<void> {
  await writeJsonFile(hubPathFor(home), hub);
}

export type HubHealth = Record<string, McpServerHealth>;

/** Every server's last test; empty before the first. */
export async function readHubHealth(home: string): Promise<HubHealth> {
  const parsed = await readJsonFile<HubHealth>(join(home, MEMNOX_HOME, HEALTH_FILE));
  return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    ? {}
    : parsed;
}

export async function writeHubHealth(home: string, health: HubHealth): Promise<void> {
  await writeJsonFile(join(home, MEMNOX_HOME, HEALTH_FILE), health);
}
