import {
  keepToolCall,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  TOOL_CALL_VIA,
  type Proposal,
} from '@memnox/core';
import { OPERATOR_AGENT } from '../session-tools/propose-tools';
import { isLocalSlug } from '../local-tools/local-run';
import { runLocal } from '../local-tools/local-tools';
import { claimAccount, runPersonalTool } from '../sync/personal-work';

/**
 * What a confirmed proposal about the person's own tools does: a send goes out in their name, and
 * an account becomes theirs for good. A refusal changes nothing, so no unanswered one signs anybody out.
 */

type Settled = { ok: true; outcome: string } | { ok: false; error: string };

/** Null where the proposal is not about the person's own tools, so the caller carries on. */
export async function applyPersonal(
  home: string,
  proposal: Proposal,
): Promise<Settled | null> {
  const change = proposal.change;
  if (change.kind === PROPOSAL_KIND.WORK && isLocalSlug(change.tool)) {
    // Confirmed with Touch ID over this exact tool and these arguments, and still through the gate.
    const ran = await runLocal(home, change.tool, change.argumentsText, true);
    return ran.ok
      ? { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${change.label}` }
      : { ok: false, error: ran.said };
  }
  if (change.kind === PROPOSAL_KIND.WORK) {
    const ran = await runPersonalTool(home, change.tool, change.argumentsText, {
      proposalId: proposal.id,
      ...(change.account?.key === undefined
        ? {}
        : { expectedAccount: change.account.key }),
    });
    if (ran.ok && proposal.proposedBy !== OPERATOR_AGENT)
      await keepWritten(home, proposal, ran.value.data);
    return ran.ok
      ? { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${change.label}` }
      : { ok: false, error: ran.said };
  }
  if (change.kind === PROPOSAL_KIND.ACCOUNT) {
    const claimed = await claimAccount(home, change.toolkit);
    return claimed.ok
      ? { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${change.label} is yours` }
      : { ok: false, error: claimed.said };
  }
  return null;
}

/** What a working agent wrote in an app once the person signed for it, kept in their own memory here like a read. */
async function keepWritten(
  home: string,
  proposal: Proposal,
  answered: unknown,
): Promise<void> {
  const change = proposal.change;
  if (change.kind !== PROPOSAL_KIND.WORK) return;
  // Best effort: the send already went, and a memory that could not be kept takes nothing back.
  await keepToolCall(home, {
    via: TOOL_CALL_VIA.APP,
    agent: proposal.proposedBy,
    app: change.toolkit,
    tool: change.tool,
    at: new Date().toISOString(),
    result: { wrote: argumentsOf(change.argumentsText), answered },
  }).catch(() => null);
}

function argumentsOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Checked when it was proposed; text that no longer parses is kept as it was sent.
    return text;
  }
}
