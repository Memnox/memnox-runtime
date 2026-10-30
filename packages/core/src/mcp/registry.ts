import type { DiscoveredAgentKind } from '../discovery/discovery.constants';
import { isKeptSecretName } from './secret-ref';

/**
 * The MCP Hub: servers declared once on this machine and handed to the agents a person
 * chose. The hub is the source of truth for the entries it wrote and for nothing else,
 * so a server a person configured by hand is shown as found and never rewritten.
 */

export const HUB_VERSION = 1;

export const HUB_TRANSPORT = {
  STDIO: 'stdio',
  HTTP: 'http',
} as const;

export type HubTransport = (typeof HUB_TRANSPORT)[keyof typeof HUB_TRANSPORT];

export interface HubServer {
  name: string;
  description?: string;
  transport: HubTransport;
  /** On stdio: the server's own launch line, which the hub puts behind the proxy. */
  command?: string;
  args?: string[];
  /** On http: where the server answers. */
  url?: string;
  /** Plain values, written into the agent's config as they are. */
  env: Record<string, string>;
  /** Env name to secret name: only a reference reaches the config, the value stays in the OS store. */
  secrets: Record<string, string>;
}

export interface HubAssignment {
  server: string;
  agent: DiscoveredAgentKind;
}

/** What the hub last wrote into one config, so a later hand edit reads as drift rather than ours. */
export interface HubWritten {
  path: string;
  server: string;
  digest: string;
}

export interface Hub {
  version: typeof HUB_VERSION;
  servers: HubServer[];
  assignments: HubAssignment[];
  written: HubWritten[];
}

/** Letters, digits and a few separators, so a name is safe as a config key, a flag value and a rule target. */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The shape every shell and every agent accepts as a variable name. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const HTTP_SCHEMES: readonly string[] = ['http:', 'https:'];

export function emptyHub(): Hub {
  return { version: HUB_VERSION, servers: [], assignments: [], written: [] };
}

/** Every reason this server cannot be written, in the words a form shows; empty when it can. */
export function hubServerProblems(server: HubServer): string[] {
  const problems: string[] = [];
  if (!SERVER_NAME.test(server.name)) {
    problems.push(
      'A name is letters, digits, dots, dashes or underscores, up to 64 of them.',
    );
  }
  problems.push(...transportProblems(server));
  for (const name of [...Object.keys(server.env), ...Object.keys(server.secrets)]) {
    if (!ENV_NAME.test(name))
      problems.push(`${name} is not a variable name an agent can pass on.`);
  }
  for (const name of Object.keys(server.secrets)) {
    if (name in server.env)
      problems.push(`${name} is set both as a value and as a secret.`);
  }
  for (const secret of Object.values(server.secrets)) {
    if (!isKeptSecretName(secret))
      problems.push(`${secret} is not a secret name Memnox can keep.`);
  }
  return problems;
}

function transportProblems(server: HubServer): string[] {
  if (server.transport === HUB_TRANSPORT.STDIO) {
    const command = server.command;
    if (command === undefined || command.trim() === '')
      return ['A local server needs the command that starts it.'];
    return [];
  }
  if (server.url === undefined)
    return ['A remote server needs the address it answers on.'];
  try {
    if (!HTTP_SCHEMES.includes(new URL(server.url).protocol)) {
      return ['A remote server is reached over http or https.'];
    }
  } catch {
    // An unparseable address is the person's to fix, so it is said rather than thrown.
    return [`${server.url} is not an address.`];
  }
  return [];
}

/** The agents a server is given to, in the order they were chosen. */
export function agentsOf(hub: Hub, server: string): DiscoveredAgentKind[] {
  return hub.assignments
    .filter((each) => each.server === server)
    .map((each) => each.agent);
}

/** The servers one agent is given. */
export function serversFor(hub: Hub, agent: DiscoveredAgentKind): HubServer[] {
  const names = new Set(
    hub.assignments.filter((each) => each.agent === agent).map((each) => each.server),
  );
  return hub.servers.filter((server) => names.has(server.name));
}

/** The hub with this server added or replaced by name, leaving its assignments as they were. */
export function withServer(hub: Hub, server: HubServer): Hub {
  const others = hub.servers.filter((each) => each.name !== server.name);
  return { ...hub, servers: [...others, server] };
}

/** The hub without this server or any of its assignments. Its written entries are removed by the next sync. */
export function withoutServer(hub: Hub, name: string): Hub {
  return {
    ...hub,
    servers: hub.servers.filter((each) => each.name !== name),
    assignments: hub.assignments.filter((each) => each.server !== name),
  };
}

/** The hub with one assignment turned on or off; turning on twice is the same as once. */
export function withAssignment(hub: Hub, assignment: HubAssignment, on: boolean): Hub {
  const others = hub.assignments.filter(
    (each) => !(each.server === assignment.server && each.agent === assignment.agent),
  );
  return { ...hub, assignments: on ? [...others, assignment] : others };
}

/** A widening change the person signs before it holds: a server added or replaced, or given to one more agent. */
export type HubChange = { put: HubServer } | { assign: HubAssignment };

export function withChange(hub: Hub, change: HubChange): Hub {
  return 'put' in change
    ? withServer(hub, change.put)
    : withAssignment(hub, change.assign, true);
}
