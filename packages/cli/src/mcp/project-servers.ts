import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_FORMAT,
  DEFAULT_SERVER_KEY,
  DISCOVERED_AGENT_KIND,
  formatOf,
  planSync,
  projectsOf,
  writtenAfter,
  type ConfigServers,
  type DiscoveredAgentKind,
  type FilePlan,
  type Hub,
  type SyncPlan,
} from '@memnox/core';
import { applyFilePlan, changes, parsedConfig, type HubConfig } from './hub-files';
import { readLocalServers, writeLocalServers } from './project-overrides';
import { readIfPresent } from './server-configs';

/**
 * A server given in one repository, written into the agent's own config for that repository and
 * nowhere every project reads. Only the hub's lines are written there; anything else is left.
 */

/** Where an agent keeps one repository's servers: a file in it, or Claude Code's local scope. */
interface ProjectLocation {
  agent: DiscoveredAgentKind;
  /** Relative to the repository; absent is Claude Code's local scope, kept in its home config. */
  relative?: string;
  /** The key a new file keeps its servers under. */
  key: string;
}

const MCP_SERVERS = DEFAULT_SERVER_KEY.json;

const PROJECT_LOCATIONS: readonly ProjectLocation[] = [
  { agent: DISCOVERED_AGENT_KIND.CLAUDE_CODE, key: MCP_SERVERS },
  { agent: DISCOVERED_AGENT_KIND.CURSOR, relative: '.cursor/mcp.json', key: MCP_SERVERS },
  { agent: DISCOVERED_AGENT_KIND.VS_CODE, relative: '.vscode/mcp.json', key: 'servers' },
  {
    agent: DISCOVERED_AGENT_KIND.CODEX_CLI,
    relative: '.codex/config.toml',
    key: DEFAULT_SERVER_KEY.toml,
  },
  {
    agent: DISCOVERED_AGENT_KIND.GEMINI_CLI,
    relative: '.gemini/settings.json',
    key: MCP_SERVERS,
  },
];

/** Whether an agent reads servers per repository, so one can be given to it in a project alone. */
export function takesProjectServers(agent: string): boolean {
  return PROJECT_LOCATIONS.some((each) => each.agent === agent);
}

/** Claude Code's local scope of one repository, as the hub's written record names it. */
function localScopeKey(home: string, root: string): string {
  return `${join(home, '.claude.json')}#${root}`;
}

export interface ProjectsSynced {
  hub: Hub;
  plan: SyncPlan;
  files: string[];
}

/** Every repository the hub gives a server in, or wrote one into, brought in step with it. */
export async function syncProjectServers(
  home: string,
  hub: Hub,
): Promise<ProjectsSynced> {
  let next = hub;
  const files: FilePlan[] = [];
  const written: string[] = [];
  for (const root of projectsOf(hub)) {
    // The home folder's configs are the agent's own, which every project reads.
    if (root === home || root === homedir()) continue;
    const synced = await syncRoot(home, next, root);
    next = synced.hub;
    files.push(...synced.plan.files);
    written.push(...synced.files);
  }
  return { hub: next, plan: { files }, files: written };
}

async function syncRoot(home: string, hub: Hub, root: string): Promise<ProjectsSynced> {
  const given = hub.assignments.filter((each) => each.project === root);
  const scoped: Hub = {
    ...hub,
    assignments: given.map(({ server, agent }) => ({ server, agent })),
  };
  const agents = new Set(given.map((each) => each.agent));
  const configs = await projectConfigs(home, root, agents, hub);
  const plan = planSync(scoped, configs);
  const files: string[] = [];
  for (const file of plan.files) {
    const config = configs.find((each) => each.path === file.path);
    if (config === undefined || !changes(file)) continue;
    if (config.local === true)
      await writeLocalServers(home, root, serversAfter(config, file));
    else await applyFilePlan(home, config, file);
    files.push(file.path);
  }
  const paths = new Set(plan.files.map((each) => each.path));
  const written = writtenAfter(hub, plan).map((each) =>
    paths.has(each.path) ? { ...each, project: root } : each,
  );
  return { hub: { ...hub, written }, plan, files };
}

type ProjectConfig = HubConfig & { local?: true };

/** The configs to plan: each one present, and a new one only for an agent given something here. */
async function projectConfigs(
  home: string,
  root: string,
  agents: ReadonlySet<DiscoveredAgentKind>,
  hub: Hub,
): Promise<ProjectConfig[]> {
  const configs: ProjectConfig[] = [];
  const ours = new Set(hub.written.map((each) => each.path));
  for (const location of PROJECT_LOCATIONS) {
    const config =
      location.relative === undefined
        ? await localScope(home, root)
        : await projectFile(join(root, location.relative), location);
    if (config === null) continue;
    const wanted = agents.has(location.agent) || ours.has(config.path);
    if (config.raw === null && !wanted) continue;
    configs.push({ ...config, agent: location.agent });
  }
  return configs;
}

async function localScope(home: string, root: string): Promise<ProjectConfig | null> {
  const servers = await readLocalServers(home, root);
  // No Claude Code config at all means it is not installed, so nothing is made for it.
  if (servers === null) return null;
  const path = localScopeKey(home, root);
  return { path, format: CONFIG_FORMAT.JSON, raw: '', servers, local: true };
}

/** A file that will not parse is left alone, since writing it back would lose what it held. */
async function projectFile(
  path: string,
  location: ProjectLocation,
): Promise<ProjectConfig | null> {
  const raw = await readIfPresent(path);
  if (raw === null)
    return {
      path,
      format: formatOf(path),
      raw: null,
      servers: {},
      key: location.key,
    };
  return parsedConfig(path, raw);
}

function serversAfter(config: ConfigServers, plan: FilePlan): Record<string, unknown> {
  const servers: Record<string, unknown> = { ...config.servers };
  for (const name of plan.remove) delete servers[name];
  for (const each of [...plan.add, ...plan.update]) servers[each.name] = each.entry;
  return servers;
}
