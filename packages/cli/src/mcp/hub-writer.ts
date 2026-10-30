import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  formatOf,
  MCP_CONFIG_LOCATIONS,
  planSync,
  readOrgServers,
  withOrganization,
  writeHub,
  writtenAfter,
  type ConfigServers,
  type Hub,
  type McpConfigLocation,
  type SyncPlan,
} from '@memnox/core';
import { applyFilePlan, changes, parsedConfig, type HubConfig } from './hub-files';
import { syncProjectServers } from './project-servers';
import { readIfPresent } from './server-configs';

/**
 * Writing what the hub holds into each agent's own MCP config, and a server given in one
 * repository into that agent's config for the repository alone, never where every project reads it.
 */

export interface HubSynced {
  hub: Hub;
  plan: SyncPlan;
  /** The files written, each backed up first. */
  files: string[];
  /** Sentences for a repository's own file left alone, which a person is told rather than left to find. */
  left: string[];
}

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
  const projects = await syncProjectServers(home, {
    ...hub,
    written: writtenAfter(hub, plan),
  });
  await writeHub(home, projects.hub);
  return {
    hub: projects.hub,
    plan: { files: [...plan.files, ...projects.plan.files] },
    files: [...files, ...projects.files],
    left: projects.left,
  };
}
