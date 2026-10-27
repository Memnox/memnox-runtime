import { SessionHosts } from '@memnox/core';

/**
 * One conversation can record under two ids: the session Memnox hosts it as, and the agent's
 * own conversation id its hooks write under. Read apart, one half shows the network and the
 * other the edits, so each reader joins them under the hosted id.
 */

/** Each agent conversation id that belongs to a hosted session, mapped to that session's id. */
export async function hostedIds(home: string): Promise<Map<string, string>> {
  const hosted = new Map<string, string>();
  for (const host of await new SessionHosts(home).all()) {
    if (host.agentSession !== undefined && host.agentSession !== host.sessionId) {
      hosted.set(host.agentSession, host.sessionId);
    }
  }
  return hosted;
}

/** Every id this session records under, its own first. */
export async function idsOf(home: string, sessionId: string): Promise<string[]> {
  const hosted = await hostedIds(home);
  const owner = hosted.get(sessionId) ?? sessionId;
  const aliases = [...hosted].filter(([, id]) => id === owner).map(([alias]) => alias);
  return [...new Set([sessionId, owner, ...aliases])];
}
