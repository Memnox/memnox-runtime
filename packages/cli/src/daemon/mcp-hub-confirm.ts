import { PROPOSAL_ANSWER, type HubChange } from '@memnox/core';
import { applyHubChange } from '../mcp/hub-changes';

/** A signed MCP Hub proposal carried out: the hub changed, and every agent's config written to match. */
export async function applyHubProposal(
  home: string,
  change: HubChange,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
  const changed = await applyHubChange(home, change);
  if ('refused' in changed) return { ok: false, error: changed.refused };
  const files = changed.synced.files.length;
  return {
    ok: true,
    outcome: `${PROPOSAL_ANSWER.CONFIRMED}: written to ${files} config${files === 1 ? '' : 's'}`,
  };
}
