import {
  INDEX_SOURCE,
  minutesToMs,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  type ProposedChange,
} from '@memnox/core';
import {
  currentIndexSource,
  resetIndexSource,
  setIndexSource,
} from '../marketplace/index-source';
import { insecureBaseUrl } from '../sync/client';

/**
 * Where the community index is read from. Another index decides what can be installed here, so
 * naming one is a proposal only the Mac signs; going back to the marketplace narrows, so it is at once.
 */

/** Who proposed it, as the card names it: the Discover page, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-index';
const PROPOSAL_TTL_MS = minutesToMs(5);

/** What setting the source did: nothing waiting, or the proposal the person signs. */
export type SourceSet = { refused: string } | { ok: true; proposed?: string };

export async function setSourceAnswer(
  home: string,
  source: string | undefined,
  now: Date,
): Promise<SourceSet> {
  const named = source === undefined ? '' : source.trim();
  if (named === '' || named === INDEX_SOURCE.MARKETPLACE) {
    await resetIndexSource(home);
    return { ok: true };
  }
  const insecure = insecureBaseUrl(named);
  if (insecure !== null) return { refused: insecure };
  if ((await currentIndexSource(home)) === named) return { ok: true };
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.INDEX_SOURCE, source: named },
    rationale: `Read the community index from ${named}, and install what it lists from there`,
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { ok: true, proposed: proposal.id };
}

/** A signed yes to another index, checked again since a proposal file can be written by hand. */
export async function applyIndexSourceProposal(
  home: string,
  change: ProposedChange,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string } | null> {
  if (change.kind !== PROPOSAL_KIND.INDEX_SOURCE) return null;
  const set = await setIndexSource(home, change.source);
  return 'refused' in set
    ? { ok: false, error: set.refused }
    : { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
}
