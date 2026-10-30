import { orgServersFrom, readHub, writeOrgServers } from '@memnox/core';
import { syncHub } from '../mcp/hub-writer';

/**
 * The organization's MCP servers, carried by the bundle, kept for the hub as a scope this machine
 * only reads, and written into the agents' configs whenever the organization changed them.
 */
export async function keepOrgMcpServers(home: string, carried: unknown): Promise<void> {
  // Absent is a bundle declaring none, which takes away any the organization handed out before.
  const changed = await writeOrgServers(home, orgServersFrom(carried ?? []));
  if (!changed) return;
  // A config that will not write must not fail the pull; the next sync from any screen writes it.
  await syncHub(home, await readHub(home)).catch(() => undefined);
}
