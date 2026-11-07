import { PROPOSAL_ANSWER, PROPOSAL_KIND, type ProposedChange } from '@memnox/core';
import { resumeAgent, stillHeldByWorkspace } from '../agents/agent-pause';
import { withoutRule } from '../studio/rule-changes';

/** A signed Policy Studio or agent manager proposal carried out: a rule taken away, or an agent let go on. */

type Settled = { ok: true; outcome: string } | { ok: false; error: string };

/** Null where the proposal is neither, so the caller carries on. */
export async function applyStudioProposal(
  home: string,
  change: ProposedChange,
  now: Date,
): Promise<Settled | null> {
  if (change.kind === PROPOSAL_KIND.RULE_REMOVE) {
    const removed = await withoutRule(change.file, change.rule);
    return removed
      ? { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED }
      : { ok: false, error: `${change.rule} is no longer in ${change.file}` };
  }
  if (change.kind === PROPOSAL_KIND.AGENT_RESUME) {
    const resumed = await resumeAgent({ home, now: () => now }, change.agent);
    return stillHeldByWorkspace(resumed)
      ? {
          ok: false,
          error: `${change.agent} is resumed here, but the workspace still holds it`,
        }
      : { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
  }
  return null;
}
