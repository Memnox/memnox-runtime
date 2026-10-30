import { readdir, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  agentShown,
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
import {
  markExcluded,
  REPO_FILE,
  repoFileState,
  type RepoFileState,
} from './repo-exclude';
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

interface ProjectsSynced {
  hub: Hub;
  plan: SyncPlan;
  files: string[];
  /** One sentence per agent a repository's own file was left alone for, said in the outcome. */
  left: string[];
}

/** Every repository the hub gives a server in, or wrote one into, brought in step with it. */
export async function syncProjectServers(
  home: string,
  hub: Hub,
): Promise<ProjectsSynced> {
  let next = hub;
  const files: FilePlan[] = [];
  const written: string[] = [];
  const left: string[] = [];
  for (const root of projectsOf(hub)) {
    // The home folder's configs are the agent's own, which every project reads.
    if (root === home || root === homedir()) continue;
    const synced = await syncRoot(home, next, root);
    next = synced.hub;
    files.push(...synced.plan.files);
    written.push(...synced.files);
    left.push(...synced.left);
  }
  return { hub: next, plan: { files }, files: written, left };
}

async function syncRoot(home: string, hub: Hub, root: string): Promise<ProjectsSynced> {
  const given = hub.assignments.filter((each) => each.project === root);
  const scoped: Hub = {
    ...hub,
    assignments: given.map(({ server, agent }) => ({ server, agent })),
  };
  const agents = new Set(given.map((each) => each.agent));
  const { configs, left } = await projectConfigs({ home, root, agents, hub });
  const plan = planSync(scoped, configs);
  const paths = new Set(plan.files.map((each) => each.path));
  const written = writtenAfter(hub, plan).map((each) =>
    paths.has(each.path) ? { ...each, project: root } : each,
  );
  const held = new Set(written.map((each) => each.path));
  const files: string[] = [];
  for (const file of plan.files) {
    const config = configs.find((each) => each.path === file.path);
    if (config === undefined || !changes(file)) continue;
    if (config.local === true)
      await writeLocalServers(home, root, serversAfter(config, file));
    else await writeInRepository({ home, root, config, file, held: held.has(file.path) });
    files.push(file.path);
  }
  await forgetRemovedFiles(root);
  return { hub: { ...hub, written }, plan, files, left };
}

type ProjectConfig = HubConfig & { local?: true };

interface ProjectConfigsInput {
  home: string;
  root: string;
  agents: ReadonlySet<DiscoveredAgentKind>;
  hub: Hub;
}

/**
 * The configs to plan: each one present, and a new one only for an agent given something here.
 * A file the repository tracks is never one of them, so writing a server never dirties a checkout.
 */
async function projectConfigs(
  input: ProjectConfigsInput,
): Promise<{ configs: ProjectConfig[]; left: string[] }> {
  const { home, root, agents, hub } = input;
  const configs: ProjectConfig[] = [];
  const left: string[] = [];
  const ours = new Set(hub.written.map((each) => each.path));
  for (const location of PROJECT_LOCATIONS) {
    const relative = location.relative;
    const config =
      relative === undefined
        ? await localScope(home, root)
        : await projectFile(join(root, relative), location);
    if (config === null) continue;
    const wanted = agents.has(location.agent) || ours.has(config.path);
    if (config.raw === null && !wanted) continue;
    const state =
      relative === undefined ? REPO_FILE.FREE : await repoFileState(root, config.path);
    if (state !== REPO_FILE.FREE) {
      if (relative !== undefined && agents.has(location.agent))
        left.push(leftAlone({ root, relative, agent: location.agent, state }));
      continue;
    }
    configs.push({ ...config, agent: location.agent });
  }
  return { configs, left };
}

interface LeftAlone {
  root: string;
  relative: string;
  agent: DiscoveredAgentKind;
  state: RepoFileState;
}

/** Said in the outcome, so a server not given is never a server the person believes was. */
function leftAlone({ root, relative, agent, state }: LeftAlone): string {
  const why =
    state === REPO_FILE.TRACKED
      ? 'which the repository tracks'
      : 'and git could not say whether the repository tracks it';
  return `${agentShown(agent)} reads the servers of ${basename(root)} from ${relative}, ${why}, so Memnox left it alone.`;
}

interface RepositoryWrite {
  home: string;
  root: string;
  config: ProjectConfig;
  file: FilePlan;
  /** Whether the hub still holds a line in the file once this is written. */
  held: boolean;
}

/**
 * Written and named in the exclude block while the hub holds a line in it, and removed with its
 * entry once it holds nothing at all; a file still holding the person's servers is theirs again.
 */
async function writeInRepository(input: RepositoryWrite): Promise<void> {
  const { home, root, config, file } = input;
  await applyFilePlan(home, config, file);
  if (!(await holdsNothing(config, file)))
    return markExcluded(root, config.path, input.held);
  await rm(config.path, { force: true });
  await removeIfEmpty(dirname(config.path));
  await markExcluded(root, config.path, false);
}

/** No servers left and nothing else in the file, so it is worth nothing to anybody. */
async function holdsNothing(config: ProjectConfig, file: FilePlan): Promise<boolean> {
  if (Object.keys(serversAfter(config, file)).length > 0) return false;
  if (config.format === CONFIG_FORMAT.JSON) {
    const key = config.key ?? MCP_SERVERS;
    return Object.keys(config.config ?? {}).every((name) => name === key);
  }
  const raw = await readIfPresent(config.path);
  return raw !== null && raw.trim() === '';
}

async function removeIfEmpty(folder: string): Promise<void> {
  const inside = await readdir(folder).catch((): string[] => ['unreadable']);
  // An agent's folder holding anything else is the person's, and stays.
  if (inside.length === 0) await rmdir(folder).catch(() => undefined);
}

/** A file the person removed takes its exclude entry with it. */
async function forgetRemovedFiles(root: string): Promise<void> {
  for (const location of PROJECT_LOCATIONS) {
    if (location.relative === undefined) continue;
    const path = join(root, location.relative);
    if ((await readIfPresent(path)) === null) await markExcluded(root, path, false);
  }
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
