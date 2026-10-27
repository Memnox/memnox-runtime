import { PROPOSAL_ANSWER, PROPOSAL_KIND, Proposals, type Proposal } from '@memnox/core';
import { BY_VOICE, OPERATOR_AGENT } from './propose-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * A draft the voice put up, taken back when the person says to discard it: closed as declined, as the card's own
 * close button does, so its card leaves the screen. Saying no does no harm, so it needs no Touch ID.
 */

/** The draft named, or the newest the voice put up that still waits, when they say "discard that one". */
export async function withdrawTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const proposals = new Proposals(deps.home);
  const moment = deps.now().toISOString();
  const target = await targetOf(proposals, textArg(args, 'proposal'), moment);
  if (target === null) return NOTHING_WAITING;
  const outcome = await proposals.answer(
    target.id,
    PROPOSAL_ANSWER.DECLINED,
    BY_VOICE,
    moment,
  );
  if (outcome === null) return NOTHING_WAITING;
  if ('alreadyAnswered' in outcome) return alreadySaid(outcome.alreadyAnswered);
  if ('expired' in outcome) {
    return {
      withdrawn: target.id,
      said: `${labelOf(target)} had already run out unanswered, so nothing went out and its card is gone. Say so in a few words.`,
    };
  }
  return {
    withdrawn: target.id,
    said: `Discarded: ${labelOf(target)}. Its card leaves their screen and nothing went out. Say so in a few words.`,
  };
}

const NOTHING_WAITING = {
  withdrawn: false,
  said: 'Nothing you put up is waiting on their screen, so nothing was discarded. Say that in a sentence, and never say it was discarded.',
};

/** The proposal named by its id, else the newest the voice put up that still waits. */
async function targetOf(
  proposals: Proposals,
  named: string | undefined,
  moment: string,
): Promise<Proposal | null> {
  if (named !== undefined) return proposals.read(named);
  const waiting = await proposals.open(moment);
  return waiting.filter((each) => each.proposedBy === OPERATOR_AGENT).at(-1) ?? null;
}

/** Answered before the person said to discard it, which is told as it is: a sent draft cannot be unsent. */
function alreadySaid(proposal: Proposal): { withdrawn: false; said: string } {
  const what = labelOf(proposal);
  if (proposal.answer === PROPOSAL_ANSWER.DECLINED) {
    return {
      withdrawn: false,
      said: `${what} was already closed, and nothing went out.`,
    };
  }
  return {
    withdrawn: false,
    said: `${what} was already confirmed with Touch ID, so it cannot be discarded now: say so plainly, and use sent to say whether it went out.`,
  };
}

function labelOf(proposal: Proposal): string {
  return proposal.change.kind === PROPOSAL_KIND.WORK
    ? `the draft "${proposal.change.label}"`
    : `the proposal "${proposal.rationale}"`;
}
