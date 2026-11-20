/**
 * Whether each MCP server an agent is configured with actually answers: started and asked
 * for its tools, the way `memnox scan` asks, because configured is not the same as there.
 */
import {
  agentShown,
  DAY_MS,
  describeTrouble,
  EVENT_SURFACE,
  SERVER_DOWN_OPERATION,
  ServerTroubles,
  type DiscoveryReport,
  type MemnoxEvent,
  type ServerTrouble,
} from '@memnox/core';

import type { CliContext } from '../../cli-context';
import { withEvents } from '../../event-store';
import { TONE } from '../../flow';

interface ServerHealth {
  name: string;
  /** Tools it listed; zero means it did not answer, or answered with nothing. */
  tools: number;
  agents: string[];
}

/** Every configured server, once however many agents declare it, with what it listed. */
export function serverHealthOf(report: DiscoveryReport): ServerHealth[] {
  const servers = new Map<string, ServerHealth>();
  for (const surface of report.surfaces) {
    const agent = report.agents.find((each) => each.id === surface.agentId)?.kind;
    for (const launch of surface.servers ?? []) {
      const known = servers.get(launch.name) ?? {
        name: launch.name,
        tools: 0,
        agents: [],
      };
      if (agent !== undefined && !known.agents.includes(agent)) known.agents.push(agent);
      servers.set(launch.name, known);
    }
  }
  const counted = new Map<string, Set<string>>();
  for (const surface of report.surfaces) {
    for (const tool of surface.tools ?? []) {
      const names = counted.get(tool.server) ?? new Set<string>();
      names.add(tool.name);
      counted.set(tool.server, names);
    }
  }
  return [...servers.values()]
    .map((server) => ({ ...server, tools: counted.get(server.name)?.size ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when every server answered. */
export function renderServerHealth(
  context: CliContext,
  servers: readonly ServerHealth[],
): boolean {
  const { flow, style } = context;
  if (servers.length === 0) {
    flow.close('No agent here is configured with an MCP server.');
    return true;
  }
  flow.list(
    'MCP servers, started and asked',
    servers.map((server) => ({
      tone: server.tools > 0 ? TONE.OK : TONE.WARN,
      text: `${server.name}  ${server.tools > 0 ? `answers, ${server.tools} tool(s)` : 'did not answer with any tool'}`,
      detail: [
        server.agents.length === 0 ? undefined : `for ${server.agents.join(', ')}`,
      ],
    })),
  );
  const silent = servers.filter((server) => server.tools === 0).length;
  flow.close(
    silent === 0
      ? style.ok(`All ${servers.length} server(s) answer.`)
      : style.warn(
          `${silent} of ${servers.length} server(s) did not answer, so an agent relying on them will fail.`,
        ),
  );
  return silent === 0;
}

/** Servers that died under an agent in the last day, as the proxy saw it happen. */
export async function recentlyStopped(home: string, now: Date): Promise<MemnoxEvent[]> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const rows = await withEvents(home, (store) =>
    store.query({ surface: EVENT_SURFACE.CONFIG, since, withConfig: true }),
  ).catch(() => []);
  return rows.filter((row) => row.operation === SERVER_DOWN_OPERATION);
}

export function renderStopped(
  context: CliContext,
  stopped: readonly MemnoxEvent[],
): void {
  if (stopped.length === 0) return;
  context.flow.list(
    'Stopped under an agent in the last day',
    stopped.map((row) => ({
      tone: TONE.WARN,
      text: `${row.at.slice(0, 16)}  ${row.reason}`,
    })),
  );
}

/** Servers a proxy could not connect for an agent and that have not connected since. */
export async function disconnected(home: string): Promise<ServerTrouble[]> {
  return new ServerTroubles(home).all();
}

/** Said first, since it names why an agent shows a server disconnected and what puts it right. */
export function renderDisconnected(
  context: CliContext,
  troubles: readonly ServerTrouble[],
): void {
  if (troubles.length === 0) return;
  context.flow.list(
    'Disconnected behind Memnox',
    troubles.map((trouble) => ({
      tone: TONE.WARN,
      text: describeTrouble(
        trouble,
        trouble.agent === undefined ? undefined : agentShown(trouble.agent),
      ),
      detail: [`since ${trouble.at.slice(0, 16)}`],
    })),
  );
}
