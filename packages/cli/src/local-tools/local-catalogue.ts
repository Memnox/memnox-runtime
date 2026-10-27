import { basename } from 'node:path';
import {
  authenticatedClis,
  detectTools,
  findCredentials,
  inferToolEffect,
  isOwnServer,
  NodeMachineReader,
  TOOL_EFFECT,
  unwrapLaunch,
  WORKSPACE_SERVER_NAME,
  type McpToolDeclaration,
  type ServerLaunch,
} from '@memnox/core';
import { readConfigs } from '../mcp/server-configs';
import type { PersonalTool } from '../sync/personal-work';
import type { McpPool } from './mcp-client';

/**
 * What this Mac already reaches with no Memnox service in between: the MCP servers the person's agents
 * are configured with, and the command line tools they are signed in to. Listed as the person's own
 * tools, so the voice reads through them directly and proposes anything that changes something.
 */

export const LOCAL_SLUG = { MCP: 'local.mcp:', CLI: 'local.cli:' } as const;

/** A server a config names, by the launch line its agent starts it with, unwrapped from the proxy. */
export interface LocalServer {
  name: string;
  launch: ServerLaunch;
}

/** A signed in command line tool, by the binary found on this Mac. */
export interface LocalCli {
  name: string;
  path: string;
  headline: string;
}

/** Tools from one place, each found in a few words. */
const TOOLS_PER_SOURCE = 8;
const MOST_DESCRIPTION_CHARS = 300;

/** Memnox's own servers, which answer about Memnox rather than reach anything of the person's. */
const OWN_SERVER_NAMES: readonly string[] = [
  WORKSPACE_SERVER_NAME,
  'memnox-session',
  'memnox-operator',
];

/** Every MCP server the person's agents declare, once each, the first config to name it winning. */
export async function localServers(home: string): Promise<LocalServer[]> {
  const found = new Map<string, LocalServer>();
  for (const file of await readConfigs(home, home).catch(() => [])) {
    for (const [name, declared] of Object.entries(file.servers)) {
      if (found.has(name) || OWN_SERVER_NAMES.includes(name)) continue;
      if (typeof declared?.command !== 'string' || !Array.isArray(declared.args))
        continue;
      const launch = unwrapLaunch(declared) ?? declared;
      if (isOwnServer(launch) || basename(launch.command).startsWith('memnox')) continue;
      found.set(name, { name, launch });
    }
  }
  return [...found.values()];
}

/** The command line tools on this Mac with a sign in they can use, as the scan finds them. */
export async function localClis(home: string): Promise<LocalCli[]> {
  const reader = new NodeMachineReader(home);
  const tools = await detectTools(reader);
  const signedIn = authenticatedClis(
    tools.map((tool) => tool.name),
    await findCredentials(reader),
    Object.keys(process.env),
  );
  return signedIn.flatMap((cli) => {
    const tool = tools.find((each) => each.name === cli.name);
    return tool === undefined
      ? []
      : [{ name: cli.name, path: tool.detectedFrom, headline: cli.headline }];
  });
}

/** What a find reaches, so a test hands in its own servers and tools. */
interface LocalSources {
  servers: () => Promise<LocalServer[]>;
  clis: () => Promise<LocalCli[]>;
  pool: McpPool;
}

/** Local tools matching the words, and only the named one where a tool was named. */
export async function findLocalTools(
  sources: LocalSources,
  what: string,
  toolkit?: string,
): Promise<PersonalTool[]> {
  const named = toolkit === undefined ? undefined : spoken(toolkit);
  const wanted = (name: string): boolean => named === undefined || spoken(name) === named;
  const [servers, clis] = await Promise.all([
    sources.servers().catch(() => []),
    sources.clis().catch(() => []),
  ]);
  const fromServers = await Promise.all(
    servers
      .filter((server) => wanted(server.name))
      .map((server) => serverTools(sources.pool, server)),
  );
  const words = wordsOf(what);
  const found: PersonalTool[] = [];
  for (const tools of fromServers) found.push(...best(tools, words, named !== undefined));
  for (const cli of clis.filter((each) => wanted(each.name))) {
    const tool = cliTool(cli);
    if (named !== undefined || score(tool, words) > 0) found.push(tool);
  }
  return found;
}

/** One server's tools, or none where it would not start or answer in time. */
async function serverTools(pool: McpPool, server: LocalServer): Promise<PersonalTool[]> {
  try {
    const declared = await pool.session(server.name, server.launch).tools();
    return declared
      .filter((each) => typeof each.name === 'string')
      .map((each) => mcpTool(server.name, each));
  } catch {
    // A server that will not start here is a gap in the answer, not a failure of the search.
    return [];
  }
}

function mcpTool(server: string, declared: McpToolDeclaration): PersonalTool {
  const description = declared.description?.slice(0, MOST_DESCRIPTION_CHARS);
  const inputs = declared.inputSchema?.properties;
  return {
    slug: `${LOCAL_SLUG.MCP}${server}:${declared.name}`,
    name: declared.name,
    ...(description === undefined ? {} : { description }),
    toolkit: server,
    ...(inputs === undefined ? {} : { inputParameters: inputs }),
    workClass: inferToolEffect(declared).effect === TOOL_EFFECT.READ ? 'read' : 'act',
    local: true,
  };
}

/** One entry per signed in tool: the arguments decide, run by run, whether it reads or changes something. */
function cliTool(cli: Pick<LocalCli, 'name' | 'headline'>): PersonalTool {
  return {
    slug: `${LOCAL_SLUG.CLI}${cli.name}`,
    name: cli.name,
    description: `${cli.headline} Runs ${cli.name} on this Mac as the person is signed in to it. Pass arguments as {"args": [...]}, the words after "${cli.name}". A command that only reads runs with run_tool; one that changes anything goes to propose_tool.`,
    toolkit: cli.name,
    inputParameters: { args: { type: 'array', items: { type: 'string' } } },
    workClass: 'read',
    local: true,
  };
}

function best(
  tools: readonly PersonalTool[],
  words: readonly string[],
  named: boolean,
): PersonalTool[] {
  const ranked = tools
    .map((tool) => ({ tool, score: score(tool, words) }))
    .filter((each) => named || each.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, TOOLS_PER_SOURCE).map((each) => each.tool);
}

function score(tool: PersonalTool, words: readonly string[]): number {
  const text = `${tool.toolkit} ${tool.name} ${tool.description ?? ''}`.toLowerCase();
  return words.filter((word) => text.includes(word)).length;
}

/** Words worth matching on, never the little ones every description holds. */
function wordsOf(what: string): string[] {
  return what
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

/** "GitHub", "git-hub" and "git hub" are one name. */
function spoken(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}
