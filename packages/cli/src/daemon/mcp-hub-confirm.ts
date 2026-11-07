import { PROPOSAL_ANSWER, type HubChange } from '@memnox/core';
import { applyHubChange } from '../mcp/hub-changes';

/** A signed MCP Hub proposal carried out: the hub changed, and every agent's config written to match. */
export async function applyHubProposal(
  home: string,
  change: HubChange,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
  const changed = await applyHubChange(home, change);
  if ('refused' in changed) return { ok: false, error: changed.refused };
  const { files, left } = changed.synced;
  const written = `${PROPOSAL_ANSWER.CONFIRMED}: written to ${files.length} config${files.length === 1 ? '' : 's'}`;
  return {
    ok: true,
    outcome: left.length === 0 ? written : `${written}. ${left.join(' ')}`,
  };
}
