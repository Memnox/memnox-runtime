/**
 * One count of what an agent here can change outside the machine, and where it lands: code,
 * databases, payments, chat, cloud. The scan, its `--json` and the voice's scan screen read it.
 */
import { SURFACE_KIND, TOOL_EFFECT } from './discovery.constants';
import { distinctTools, nameSegments } from './surface';
import type { DiscoveryReport } from './discover';
import { externalStateVerbs, verbAction } from '../verbs/verb-table';
import { verbTableFor } from '../verbs/tables';

export const CAPABILITY_AREA = {
  CODE: 'code',
  DATABASES: 'databases',
  PAYMENTS: 'payments',
  CHAT: 'chat',
  CLOUD: 'cloud',
  OTHER: 'other',
} as const;

export type CapabilityArea = (typeof CAPABILITY_AREA)[keyof typeof CAPABILITY_AREA];

/** The order areas are said in, which is the order a person recognises them in. */
const AREA_ORDER: readonly CapabilityArea[] = Object.values(CAPABILITY_AREA);

/** The words a sentence uses for each area. */
export const AREA_WORDS: Readonly<Record<CapabilityArea, string>> = {
  code: 'code',
  databases: 'databases',
  payments: 'payments',
  chat: "your team's chat",
  cloud: 'cloud',
  other: 'other tools',
};

/** A name segment that places a server or a CLI in an area; the first area that matches wins. */
const AREA_SIGNS: readonly (readonly [CapabilityArea, readonly string[]])[] = [
  [
    'payments',
    [
      'stripe',
      'paypal',
      'square',
      'braintree',
      'adyen',
      'lemonsqueezy',
      'paddle',
      'billing',
      'payment',
      'refund',
      'invoice',
    ],
  ],
  [
    'databases',
    [
      'psql',
      'pgcli',
      'postgres',
      'postgresql',
      'mysql',
      'mycli',
      'mariadb',
      'mongosh',
      'mongodb',
      'mongo',
      'redis',
      'sqlite',
      'supabase',
      'neon',
      'planetscale',
      'snowflake',
      'bigquery',
      'clickhouse',
      'dynamodb',
      'database',
      'db',
      'sql',
      'prisma',
    ],
  ],
  [
    'chat',
    ['slack', 'discord', 'teams', 'telegram', 'whatsapp', 'mattermost', 'zulip', 'chat'],
  ],
  [
    'code',
    [
      'git',
      'gh',
      'github',
      'gitlab',
      'bitbucket',
      'npm',
      'filesystem',
      'fs',
      'code',
      'repo',
    ],
  ],
  [
    'cloud',
    [
      'aws',
      'gcloud',
      'gcp',
      'az',
      'azure',
      'kubectl',
      'kubernetes',
      'k8s',
      'terraform',
      'pulumi',
      'docker',
      'vercel',
      'railway',
      'fly',
      'heroku',
      'netlify',
      'cloudflare',
      'render',
      'deploy',
    ],
  ],
];

export function areaOf(name: string): CapabilityArea {
  const segments = new Set(nameSegments(name));
  for (const [area, signs] of AREA_SIGNS) {
    if (signs.some((sign) => segments.has(sign))) return area;
  }
  return CAPABILITY_AREA.OTHER;
}

/** A server named for nothing in particular, such as a gateway, is placed by its tool's name. */
function areaOfTool(server: string, tool: string): CapabilityArea {
  const byServer = areaOf(server);
  return byServer === CAPABILITY_AREA.OTHER ? areaOf(tool) : byServer;
}

/** One thing that can change something outside the machine, and which agents can do it. */
export interface ReachingCapability {
  /** The action a rule is written about: `mcp.<tool>` or `<cli>.<verb>`. */
  action: string;
  /** The server or CLI it is reached through, which is what names its area. */
  via: string;
  area: CapabilityArea;
  agentIds: string[];
}

export interface AreaCount {
  area: CapabilityArea;
  count: number;
}

/**
 * A count and where it lands. `total` is absent while any server has never said what it
 * holds, because a zero there would be a guess drawn as a fact.
 */
export interface CapabilityTally {
  total?: number;
  areas: AreaCount[];
}

/**
 * The one count of what an agent here can change outside the machine: MCP tools classed write
 * or destructive, and the write or destructive verbs of each signed in CLI. The scan's closing
 * line, `--json` and the voice's scan screen all read this.
 */
export function capabilitiesOf(report: DiscoveryReport): ReachingCapability[] {
  const tools = distinctTools(report.surfaces)
    .filter(
      (tool) =>
        tool.effect === TOOL_EFFECT.WRITE || tool.effect === TOOL_EFFECT.DESTRUCTIVE,
    )
    .map((tool) => ({
      action: `mcp.${tool.name}`,
      via: tool.server,
      area: areaOfTool(tool.server, tool.name),
      agentIds: agentsHolding(report, tool.server, tool.name),
    }));
  // A signed in CLI is reach only through a shell, so only an agent with one is credited.
  const shells = [
    ...new Set(
      report.surfaces
        .filter((surface) => surface.kind === SURFACE_KIND.SHELL)
        .map((surface) => surface.agentId),
    ),
  ];
  const clis = [...new Set(report.authenticated.map((cli) => cli.name))].flatMap(
    (name) => {
      const table = verbTableFor(name);
      if (table === null) return [];
      return externalStateVerbs(table).map((verb) => ({
        action: verbAction(name, verb),
        via: name,
        area: areaOf(name),
        agentIds: shells,
      }));
    },
  );
  return [...tools, ...clis];
}

function agentsHolding(report: DiscoveryReport, server: string, tool: string): string[] {
  const holders = report.surfaces
    .filter((surface) =>
      (surface.tools ?? []).some((each) => each.server === server && each.name === tool),
    )
    .map((surface) => surface.agentId);
  return [...new Set(holders)];
}

export function tallyOf(
  capabilities: readonly ReachingCapability[],
  counted = true,
): CapabilityTally {
  const areas = AREA_ORDER.map((area) => ({
    area,
    count: capabilities.filter((each) => each.area === area).length,
  })).filter((each) => each.count > 0);
  return counted ? { total: capabilities.length, areas } : { areas };
}

/**
 * Each capability credited to the first agent in `agentIds` order that holds it, so the
 * per agent tallies sum to the machine's distinct count and a screen can add them up.
 */
export function creditedTallies(
  capabilities: readonly ReachingCapability[],
  agentIds: readonly string[],
  counted = true,
): Map<string, CapabilityTally> {
  const credited = new Map<string, ReachingCapability[]>(agentIds.map((id) => [id, []]));
  for (const capability of capabilities) {
    const first = agentIds.find((id) => capability.agentIds.includes(id));
    if (first !== undefined) credited.get(first)?.push(capability);
  }
  return new Map(
    [...credited].map(([id, owned]) => [id, tallyOf(owned, counted)] as const),
  );
}

/** "code, databases, payments and your team's chat", in the fixed order, or null for none. */
export function areaPhrase(areas: readonly AreaCount[]): string | null {
  const words = areas.map((each) => AREA_WORDS[each.area]);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0] ?? null;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}
