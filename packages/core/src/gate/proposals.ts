import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import type { DaemonEvent } from '../daemon/protocol';
import type { RuleScope } from '../daemon/voice-cards';
import type { Policy } from '../policy/policy';
import { JsonRecordDir } from '../store/json-records';
import type { HoldAnswer } from './hold';
import { PROPOSAL_ANSWER, type ProposalAnswer } from './answers';
import type { WorkAccount } from '../daemon/work-cards';

export { PROPOSAL_ANSWER, type ProposalAnswer };

/**
 * A change something other than a person suggested, written down and never applied until a
 * person confirms it. The operator's model reads everything and writes only these.
 */

export const PROPOSALS_DIR = 'proposals';

export const PROPOSAL_KIND = {
  /** Rules merged by name into a policy file. */
  RULES: 'rules',
  /** An answer to a call that is being held. */
  ANSWER: 'answer',
  /** Lifting a pause, which lets a stopped session carry on. */
  RESUME: 'resume',
  /** The working tree of a repository put back to a milestone, which keeps the tree as it was first. */
  REWIND: 'rewind',
  /** A memnox command that changes something, run once the person confirms. */
  COMMAND: 'command',
  /** Something only the Mac can do, asked for from a phone, shown on the Mac once that phone signs. */
  MAC: 'mac',
  /** An answer to a team's question, carried out by the device holding the person's sign in. */
  TEAM: 'team',
  /** A tool run through the person's own account, so it speaks as them, once they sign for it. */
  WORK: 'work',
  /** An account a sign in reached, said once to be the person's own so it is matched from then on. */
  ACCOUNT: 'account',
} as const;

export type ProposedChange =
  | {
      kind: typeof PROPOSAL_KIND.RULES;
      /** Where a plain "confirmed" puts the rules: the suggested scope's file. */
      file: string;
      rules: readonly Policy[];
      /** The places offered on the Mac; the one picked is the signed answer, and decides the file and the reach. */
      scopes?: readonly RuleScope[];
      /** A spoken rule on an enrolled machine: in force here once signed, and offered to the team as well. */
      offerTeam?: boolean;
    }
  | { kind: typeof PROPOSAL_KIND.ANSWER; pendingId: string; answer: HoldAnswer }
  | { kind: typeof PROPOSAL_KIND.RESUME; sessionId: string }
  | {
      kind: typeof PROPOSAL_KIND.REWIND;
      repository: string;
      milestone: string;
      sessionId?: string;
    }
  | { kind: typeof PROPOSAL_KIND.COMMAND; argv: string[] }
  | { kind: typeof PROPOSAL_KIND.MAC; deviceId: string; event: DaemonEvent }
  | {
      kind: typeof PROPOSAL_KIND.TEAM;
      callId: string;
      answer: HoldAnswer;
      label: string;
    }
  | {
      kind: typeof PROPOSAL_KIND.WORK;
      toolkit: string;
      tool: string;
      /** The arguments as the exact JSON text the control plane is sent and the signature covers. */
      argumentsText: string;
      /** What it does, in the words the person heard read back. */
      label: string;
      /** Whose account it goes out as, which the run is refused under any other. */
      account?: WorkAccount;
      /** Who it goes to as their tool names them, since the tool itself takes an id nobody can read. */
      toName?: string;
    }
  | {
      kind: typeof PROPOSAL_KIND.ACCOUNT;
      toolkit: string;
      /** The account as the person heard it named: "maya on GitHub". */
      label: string;
    };

export interface Proposal {
  id: string;
  change: ProposedChange;
  /** Why, in the words the person heard, so the confirmation is of the same thing. */
  rationale: string;
  /** What the person said out loud, when they said something, kept for the ledger row. */
  said?: string;
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  answer?: ProposalAnswer;
  answeredAt?: string;
  answeredBy?: string;
  /** What carrying it out came to, for work done in the person's name, so "did it go?" is answered from fact. */
  ran?: ProposalRan;
}

export interface ProposalRan {
  ok: boolean;
  /** What went out, or why it did not, in the words the tool or the workspace gave. */
  said: string;
  at: string;
  /** Who it went to, as sent, so a mail readdressed on its card is reported at the address it really went to. */
  to?: string[];
}

export type ProposalOutcome =
  { answered: Proposal } | { alreadyAnswered: Proposal } | { expired: Proposal } | null;

export interface ProposeInput {
  change: ProposedChange;
  rationale: string;
  said?: string;
  proposedBy: string;
  at: string;
  ttlMs: number;
}

export function proposalsDirFor(home: string): string {
  return join(home, MEMNOX_HOME, PROPOSALS_DIR);
}

export function proposalIdFor(change: ProposedChange, at: string): string {
  return `prp_${Date.parse(at).toString(36)}_${shortDigest(JSON.stringify(change))}`;
}

export class Proposals {
  private readonly records: JsonRecordDir<Proposal>;

  constructor(home: string) {
    this.records = new JsonRecordDir(proposalsDirFor(home));
  }

  async propose(input: ProposeInput): Promise<Proposal> {
    const proposal: Proposal = {
      id: proposalIdFor(input.change, input.at),
      change: input.change,
      rationale: input.rationale,
      ...(input.said === undefined ? {} : { said: input.said }),
      proposedBy: input.proposedBy,
      proposedAt: input.at,
      expiresAt: new Date(Date.parse(input.at) + input.ttlMs).toISOString(),
    };
    await this.records.write(proposal.id, proposal);
    return proposal;
  }

  read(id: string): Promise<Proposal | null> {
    return this.records.read(id);
  }

  /** Only what can still be answered, oldest first, so the first one spoken is the first raised. */
  async open(moment: string): Promise<Proposal[]> {
    const found = await this.records.all();
    return found
      .filter((proposal) => proposal.answer === undefined && proposal.expiresAt > moment)
      .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
  }

  /** What carrying a confirmed proposal out came to, written beside the answer. */
  async ran(id: string, ran: ProposalRan): Promise<void> {
    const proposal = await this.read(id);
    if (proposal === null) return;
    await this.records.write(id, { ...proposal, ran });
  }

  /** Every proposal raised since a moment, newest first, answered or not. */
  async since(moment: string): Promise<Proposal[]> {
    const found = await this.records.all();
    return found
      .filter((proposal) => proposal.proposedAt >= moment)
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  }

  /** First answer wins; an expired proposal is never confirmed, because the person heard an old one. */
  async answer(
    id: string,
    answer: ProposalAnswer,
    by: string,
    at: string,
  ): Promise<ProposalOutcome> {
    const proposal = await this.read(id);
    if (proposal === null) return null;
    if (proposal.answer !== undefined) return { alreadyAnswered: proposal };
    if (proposal.expiresAt <= at) return { expired: proposal };
    const answered: Proposal = { ...proposal, answer, answeredAt: at, answeredBy: by };
    await this.records.write(id, answered);
    return { answered };
  }
}
