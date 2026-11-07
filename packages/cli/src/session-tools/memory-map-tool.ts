import { existsSync } from 'node:fs';
import {
  agentShown,
  LIVE_STATUSES,
  MEMORY_STATUS,
  memoryDatabasePathFor,
  SqliteMemoryStore,
  type McpHubServerView,
  type SecretStore,
  type SkillsHubView,
} from '@memnox/core';
import { readHubView } from '../mcp/hub-view';
import { readScannedServers, type ScannedServer } from '../operator/vocabulary';
import { agentKindOf } from '../skills/skill-import';
import { readSkillsView } from '../skills/skills-view';
import { readRulesView } from '../studio/rules-in-force';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { rulesInForceTool } from './rules-tool';
import { readTool, type ToolDefinition } from './session-tools';
import { MACHINE } from '../this-machine';

/**
 * What the memory on this machine holds, as exact counts and then a few names a page, read from the
 * same readers the memory map and the Skills and MCP hubs draw, so the voice never counts a cut list.
 */

/** Enough to say a few aloud and offer more, the same page as rules_in_force. */
const PER_PAGE = 8;

/** Tool names said per server, since a name or two says what it can do and the rest only costs tokens. */
const TOOLS_SAID = 6;

/** A skill's description is said in a phrase, never its whole page. */
const DESCRIPTION_CHARS = 120;

const KIND = {
  SKILLS: 'skills',
  SERVERS: 'servers',
  MEMORIES: 'memories',
  SOURCES: 'sources',
  RULES: 'rules',
  CONNECTIONS: 'connections',
} as const;

type Kind = (typeof KIND)[keyof typeof KIND];

const KINDS: readonly string[] = Object.values(KIND);

/** What a person says for a kind, so "apps", "mcp" or "facts" lands on the list they meant. */
const KIND_WORDS: Readonly<Record<string, Kind>> = {
  skill: KIND.SKILLS,
  server: KIND.SERVERS,
  mcp: KIND.SERVERS,
  mcps: KIND.SERVERS,
  applications: KIND.SERVERS,
  application: KIND.SERVERS,
  memory: KIND.MEMORIES,
  facts: KIND.MEMORIES,
  fact: KIND.MEMORIES,
  source: KIND.SOURCES,
  rule: KIND.RULES,
  policies: KIND.RULES,
  apps: KIND.CONNECTIONS,
  connection: KIND.CONNECTIONS,
  accounts: KIND.CONNECTIONS,
};

/** The Mac's own word for a found entry that is a skill rather than a persona. */
const FOUND_SKILL = 'skill';

/** Said for a hub skill nobody was given yet, so per agent counts still add up to the total. */
const NO_AGENT = 'no agent yet';

/** The hub is read here only for names, agents and tools, so no secret is ever looked up. */
const NO_SECRETS: SecretStore = {
  get: async () => undefined,
  set: async () => undefined,
  remove: async () => undefined,
};

export const MEMORY_MAP_TOOL: ToolDefinition = readTool(
  'memory_map',
  `Everything the memory on this ${MACHINE} holds, from the same readers as its memory map and its Skills and MCP hubs: exact counts of skills, rules, MCP servers, memories, sources and connected apps. Pass kind for one of them: its exact total, skills and servers counted per agent, then eight names a page, a server with the tools it offers or its description, with next as cursor for more. Answer "how many skills", "what skills do I have", "how many MCPs and what do they do", "what is in my memory" and "which apps are connected" from here, never from show_list, memnox_command or reach.`,
  {
    kind: {
      type: 'string',
      description:
        'skills, servers, memories, sources, rules or connections; every count and no names when left out',
    },
    about: {
      type: 'string',
      description:
        'one word a name, description or tool names, such as "review" or "github"',
    },
    agent: {
      type: 'string',
      description: 'only what this agent has, such as "codex" or "Claude Code"',
    },
    cursor: { type: 'string', description: 'the next an earlier answer gave, for more' },
  },
);

const READ_COUNTS =
  'Say the exact counts in one sentence. For the names of one kind call again with kind; never guess a count from a list.';

const READ_PAGE =
  'Say the exact total first. When asked to list them, say these names, and what each can do where its line says; never say the list was cut off, because total is every one and next gives the rest. Pass next as cursor for more, about or agent to narrow.';

/** One thing on the map as a line, with what an about or agent filter matches it by. */
interface Entry {
  line: string;
  agents: readonly string[];
  words: string;
}

export async function memoryMapTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const asked = textArg(args, 'kind')?.toLowerCase();
  if (asked === undefined) return countsOf(deps);
  const kind = KINDS.includes(asked) ? (asked as Kind) : KIND_WORDS[asked];
  if (kind === undefined)
    return { said: `Pass kind as one of ${KINDS.join(', ')}, or leave it out.` };
  // The rules have their own reader and their own words, so one answer never says them two ways.
  if (kind === KIND.RULES) return rulesInForceTool(deps, args);
  const read = await entriesOf(deps, kind);
  if ('said' in read) return read;
  return { kind, ...read.extra, ...paged(read.entries, args) };
}

async function countsOf(deps: SessionToolDeps): Promise<unknown> {
  const [skills, servers, memory, rules, connected] = await Promise.all([
    readSkills(deps.home),
    readServers(deps),
    readMemory(deps.home),
    readRulesView(deps.home, deps.now()),
    readConnections(deps),
  ]);
  return {
    holds: {
      skills: skills.length,
      rules: rules.rules.length,
      servers: servers.length,
      memories: memory.memories,
      unconfirmedMemories: memory.unconfirmed,
      sources: memory.sources.length,
      ...('said' in connected ? {} : { connectedApps: connected.length }),
    },
    skillsByAgent: byAgent(skills),
    serversInHub: servers.filter((each) => each.inHub).length,
    ...('said' in connected ? { connectedApps: connected.said } : {}),
    read: READ_COUNTS,
  };
}

type Read = { entries: Entry[]; extra: Record<string, unknown> } | { said: string };

async function entriesOf(deps: SessionToolDeps, kind: Kind): Promise<Read> {
  switch (kind) {
    case KIND.SKILLS: {
      const skills = await readSkills(deps.home);
      return { entries: skills, extra: { byAgent: byAgent(skills) } };
    }
    case KIND.SERVERS: {
      const servers = await readServers(deps);
      return {
        entries: servers,
        extra: {
          byAgent: byAgent(servers),
          inHub: servers.filter((each) => each.inHub).length,
        },
      };
    }
    case KIND.MEMORIES: {
      const memory = await readMemory(deps.home);
      return {
        entries: memory.items,
        extra: { memories: memory.memories, unconfirmed: memory.unconfirmed },
      };
    }
    case KIND.SOURCES:
      return { entries: (await readMemory(deps.home)).sources, extra: {} };
    case KIND.CONNECTIONS: {
      const connected = await readConnections(deps);
      return 'said' in connected ? connected : { entries: connected, extra: {} };
    }
    case KIND.RULES:
      return { entries: [], extra: {} };
  }
}

function paged(entries: readonly Entry[], args: ToolArgs): Record<string, unknown> {
  const about = textArg(args, 'about')?.toLowerCase();
  const agent = textArg(args, 'agent')?.toLowerCase();
  const matching = entries.filter(
    (entry) =>
      (about === undefined || entry.words.includes(about)) &&
      (agent === undefined ||
        entry.agents.some((each) => each.toLowerCase().includes(agent))),
  );
  const from = startOf(textArg(args, 'cursor'));
  const page = matching.slice(from, from + PER_PAGE);
  const after = from + page.length;
  return {
    total: entries.length,
    ...(about === undefined && agent === undefined ? {} : { matching: matching.length }),
    names: page.map((entry) => entry.line),
    ...(after < matching.length
      ? { more: matching.length - after, next: String(after) }
      : {}),
    read: READ_PAGE,
  };
}

/**
 * The skills the memory map draws: every one the hub keeps, then each skill an agent's folder holds
 * that the hub has not brought in, once by name, which is how the Mac counts them.
 */
async function readSkills(home: string): Promise<Entry[]> {
  const view: SkillsHubView = await readSkillsView(home);
  const entries = new Map<string, { agents: Set<string>; description: string }>();
  for (const skill of view.skills)
    entries.set(skill.name, {
      agents: new Set(skill.agents.map(agentShown)),
      description: skill.description,
    });
  for (const found of view.found) {
    if (found.kind !== FOUND_SKILL || found.imported) continue;
    // The Mac says a found skill by its grant, since its folder carries no description the hub read.
    const kept = entries.get(found.name) ?? {
      agents: new Set<string>(),
      description: found.grant,
    };
    kept.agents.add(agentShown(agentKindOf(found.agent)));
    entries.set(found.name, kept);
  }
  return [...entries]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { agents, description }]) => {
      const said = shortened(description);
      const by = [...agents];
      return {
        line: `${name}${said === '' ? '' : `: ${said}`} (${by.length === 0 ? NO_AGENT : by.join(', ')})`,
        agents: by,
        words: `${name} ${description}`.toLowerCase(),
      };
    });
}

interface ServerEntry extends Entry {
  inHub: boolean;
}

/**
 * Every MCP server here: the hub's, with its description and the tools its last test found, and each
 * one the last scan saw in an agent's config, so a server the hub never took in is still counted.
 */
async function readServers(deps: SessionToolDeps): Promise<ServerEntry[]> {
  const [hub, scanned] = await Promise.all([
    readHubView(deps.home, { secrets: NO_SECRETS, now: deps.now() }).catch(() => null),
    readScannedServers(deps.home).catch((): ScannedServer[] => []),
  ]);
  const byName = new Map<string, Merged>();
  for (const server of hub?.servers ?? []) byName.set(server.name, fromHub(server));
  for (const server of scanned) {
    const kept = byName.get(server.name) ?? {
      agents: new Set<string>(),
      tools: new Set<string>(),
      inHub: false,
    };
    for (const agent of server.agents) kept.agents.add(agent);
    for (const tool of server.tools) kept.tools.add(tool);
    byName.set(server.name, kept);
  }
  return [...byName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, merged]) => serverEntry(name, merged));
}

interface Merged {
  agents: Set<string>;
  tools: Set<string>;
  description?: string;
  inHub: boolean;
}

function fromHub(server: McpHubServerView): Merged {
  const tools = server.tools ?? server.health.tools ?? [];
  return {
    agents: new Set(server.agents.map(agentShown)),
    tools: new Set(tools.map((tool) => tool.name)),
    ...(server.description === undefined ? {} : { description: server.description }),
    inHub: true,
  };
}

function serverEntry(
  name: string,
  { agents, tools, description, inHub }: Merged,
): ServerEntry {
  const by = [...agents];
  const offered = [...tools];
  const can =
    offered.length > 0
      ? `offers ${offered.slice(0, TOOLS_SAID).join(', ')}${offered.length > TOOLS_SAID ? ` and ${offered.length - TOOLS_SAID} more` : ''}`
      : '';
  const said = [description === undefined ? '' : shortened(description), can]
    .filter((each) => each !== '')
    .join('; ');
  return {
    line: `${name}: ${said === '' ? 'nothing known yet of what it can do' : said} (${by.length === 0 ? NO_AGENT : by.join(', ')}${inHub ? '; in the MCP Hub' : ''})`,
    agents: by,
    words: [name, description ?? '', ...offered].join(' ').toLowerCase(),
    inHub,
  };
}

interface MemoryRead {
  memories: number;
  unconfirmed: number;
  items: Entry[];
  sources: Entry[];
}

/** What this machine learned and where from, read from the local store, which is opened only when it exists. */
async function readMemory(home: string): Promise<MemoryRead> {
  if (!existsSync(memoryDatabasePathFor(home)))
    return { memories: 0, unconfirmed: 0, items: [], sources: [] };
  const store = SqliteMemoryStore.forHome(home);
  try {
    const verified = store.count({ statuses: [MEMORY_STATUS.VERIFIED] });
    const live = store.count({ statuses: LIVE_STATUSES });
    const names = new Map(store.sources().map((each) => [each.id, each.name]));
    // Confirmed first, since an unconfirmed note is never said as settled.
    const items = store
      .items({ statuses: LIVE_STATUSES })
      .sort(
        (a, b) =>
          Number(b.status === MEMORY_STATUS.VERIFIED) -
          Number(a.status === MEMORY_STATUS.VERIFIED),
      )
      .map((item) => {
        const from = item.sourceId === undefined ? undefined : names.get(item.sourceId);
        const status = item.status === MEMORY_STATUS.VERIFIED ? '' : ', unconfirmed';
        return {
          line: `${item.subject}: ${item.statement} (${item.kind}${status}${from === undefined ? '' : `, from ${from}`})`,
          agents: [],
          words: `${item.subject} ${item.statement} ${from ?? ''}`.toLowerCase(),
        };
      });
    const sources = store.sources().map((source) => ({
      line: `${source.name} (${source.kind}${source.project === undefined ? '' : `, ${source.project}`})`,
      agents: [],
      words: `${source.name} ${source.kind} ${source.project ?? ''}`.toLowerCase(),
    }));
    return { memories: verified, unconfirmed: live - verified, items, sources };
  } finally {
    store.close();
  }
}

/** The apps the workspace connected to the person, the same list the Mac's Tools panel shows. */
async function readConnections(
  deps: SessionToolDeps,
): Promise<Entry[] | { said: string }> {
  const ask = deps.personalWork?.connections;
  if (ask === undefined)
    return {
      said: `This ${MACHINE} cannot ask which apps are connected; my_accounts says who they are signed in as.`,
    };
  const answer = await ask().catch(() => null);
  if (answer === null || !answer.ok)
    return {
      said:
        answer?.ok === false
          ? answer.said
          : 'Memnox Cloud could not be asked which apps are connected just now.',
    };
  return answer.value
    .filter((each) => each.connected && each.local !== true)
    .map((each) => {
      const by = [...new Set((each.usedBy ?? []).map((use) => agentShown(use.agent)))];
      return {
        line: `${each.toolkit}${by.length === 0 ? '' : ` (used by ${by.join(', ')})`}`,
        agents: by,
        words: each.toolkit.toLowerCase(),
      };
    });
}

function byAgent(entries: readonly Entry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries)
    for (const agent of entry.agents.length === 0 ? [NO_AGENT] : entry.agents)
      counts[agent] = (counts[agent] ?? 0) + 1;
  return counts;
}

function shortened(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= DESCRIPTION_CHARS
    ? line
    : `${line.slice(0, DESCRIPTION_CHARS).trimEnd()}...`;
}

function startOf(cursor: string | undefined): number {
  const start = Number(cursor ?? 0);
  return Number.isInteger(start) && start > 0 ? start : 0;
}
