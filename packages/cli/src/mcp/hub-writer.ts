import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  appendTextServer,
  CONFIG_FORMAT,
  DEFAULT_SERVER_KEY,
  formatOf,
  MCP_CONFIG_LOCATIONS,
  planSync,
  readOrgServers,
  readTextServers,
  removeTextServer,
  serversKeyOf,
  withOrganization,
  writeHub,
  writtenAfter,
  type ConfigServers,
  type FilePlan,
  type Hub,
  type HubEntry,
  type McpConfigLocation,
  type ServerLaunch,
  type SyncPlan,
} from '@memnox/core';
import { backupPathFor } from '../memnox-paths';
import { readIfPresent } from './server-configs';

/**
 * Writing what the hub holds into each agent's own MCP config, backup first. Only lines the
 * hub wrote are ever changed or removed; a server the person configured is read and left.
 */

/** One config as the hub reads it: its servers, and what is needed to write it back. */
interface HubConfig extends ConfigServers {
  /** The file as it was read; null for an agent that has no config yet, which the hub may create. */
  raw: string | null;
  /** A JSON config, whole, and the key its servers sit under. */
  config?: Record<string, unknown>;
  key?: string;
}

export interface HubSynced {
  hub: Hub;
  plan: SyncPlan;
  /** The files written, each backed up first. */
  files: string[];
}

const JSON_INDENT = 2;
const OWNER_ONLY_DIR = 0o700;

/** Every config the hub can see, plus an empty one for an installed agent that has none yet. */
export async function readHubConfigs(
  home: string,
  project: string,
): Promise<HubConfig[]> {
  const read: HubConfig[] = [];
  const missing: { path: string; location: McpConfigLocation }[] = [];
  for (const location of MCP_CONFIG_LOCATIONS) {
    const path = join(location.scope === 'home' ? home : project, location.relative);
    const raw = await readIfPresent(path);
    if (raw === null) {
      missing.push({ path, location });
      continue;
    }
    const config = parsedConfig(path, raw);
    if (config !== null) read.push({ ...config, ...ownerOf(location) });
  }
  return [...read, ...(await emptyConfigs(home, missing, read))];
}

function ownerOf(location: McpConfigLocation): Pick<ConfigServers, 'agent' | 'shared'> {
  return {
    ...(location.agent === undefined ? {} : { agent: location.agent }),
    ...(location.scope === 'project' ? { shared: true as const } : {}),
  };
}

/** A file read as servers, or null for one that will not parse, since writing it back would lose what it held. */
function parsedConfig(path: string, raw: string): HubConfig | null {
  const format = formatOf(path);
  if (format !== CONFIG_FORMAT.JSON) {
    const { servers, urlOnly } = readTextServers(format, raw);
    const remote = Object.fromEntries(urlOnly.map((name) => [name, {}]));
    return { path, format, raw, servers: { ...remote, ...servers } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never rewrite a file we could not parse: we would lose what it held.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  // Cast is safe: a plain object was checked just above.
  const config = parsed as Record<string, unknown>;
  const key = serversKeyOf(config);
  // Cast is safe: serversKeyOf only names a key holding an object.
  const servers = key === null ? {} : (config[key] as Record<string, unknown>);
  return { path, format, raw, config, ...(key === null ? {} : { key }), servers };
}

/**
 * Conservative on purpose: only the home config of an agent whose own folder is here and that
 * has no config anywhere else, so the hub never invents a file for an agent that is not installed.
 */
async function emptyConfigs(
  home: string,
  missing: readonly { path: string; location: McpConfigLocation }[],
  read: readonly HubConfig[],
): Promise<HubConfig[]> {
  const held = new Set(read.map((each) => each.agent));
  const made: HubConfig[] = [];
  for (const { path, location } of missing) {
    const agent = location.agent;
    if (agent === undefined || location.scope !== 'home' || held.has(agent)) continue;
    const folder = dirname(path);
    if (folder === home || !(await isFolder(folder))) continue;
    held.add(agent);
    made.push({ path, format: formatOf(path), agent, raw: null, servers: {} });
  }
  return made;
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Absent is the ordinary answer here: the agent is not installed.
    return false;
  }
}

/**
 * Plans the hub, with the organization's servers beside its own, against every config, writes the
 * changes, and keeps what was written as the hub's own so a later hand edit reads as drift.
 */
export async function syncHub(
  home: string,
  hub: Hub,
  project: string = home,
): Promise<HubSynced> {
  const configs = await readHubConfigs(home, project);
  const plan = planSync(withOrganization(hub, await readOrgServers(home)), configs);
  const files: string[] = [];
  for (const file of plan.files) {
    const config = configs.find((each) => each.path === file.path);
    if (config === undefined || !changes(file)) continue;
    await applyFilePlan(home, config, file);
    files.push(file.path);
  }
  const next = { ...hub, written: writtenAfter(hub, plan) };
  await writeHub(home, next);
  return { hub: next, plan, files };
}

function changes(plan: FilePlan): boolean {
  return plan.add.length + plan.update.length + plan.remove.length > 0;
}

/** One file's adds, updates and removals. Found and drifted lines are never touched. */
export async function applyFilePlan(
  home: string,
  config: HubConfig,
  plan: FilePlan,
): Promise<void> {
  if (!changes(plan)) return;
  if (config.raw === null) {
    await mkdir(dirname(config.path), { recursive: true, mode: OWNER_ONLY_DIR });
  } else {
    const backup = backupPathFor(home, config.path);
    await mkdir(dirname(backup), { recursive: true, mode: OWNER_ONLY_DIR });
    await copyFile(config.path, backup);
  }
  const next =
    config.format === CONFIG_FORMAT.JSON
      ? jsonAfter(config, plan)
      : textAfter(config, plan);
  await writeFile(config.path, next, 'utf8');
}

function jsonAfter(config: HubConfig, plan: FilePlan): string {
  const key = config.key ?? DEFAULT_SERVER_KEY.json;
  const servers: Record<string, unknown> = { ...config.servers };
  for (const name of plan.remove) delete servers[name];
  for (const each of [...plan.add, ...plan.update]) servers[each.name] = each.entry;
  const whole = { ...(config.config ?? {}), [key]: servers };
  return `${JSON.stringify(whole, null, JSON_INDENT)}\n`;
}

/** An update is a removal and an append, so every line that is not the server's own stays as it was. */
function textAfter(config: HubConfig, plan: FilePlan): string {
  let raw = config.raw ?? '';
  for (const name of [...plan.remove, ...plan.update.map((each) => each.name)])
    raw = removeTextServer(config.format, raw, name);
  for (const each of [...plan.add, ...plan.update]) {
    const launch = launchOf(each.entry);
    // The planner skips a remote server for a text config, so only a launch line reaches here.
    if (launch !== null) raw = appendTextServer(config.format, raw, each.name, launch);
  }
  return raw;
}

function launchOf(entry: HubEntry): ServerLaunch | null {
  return 'command' in entry ? entry : null;
}
