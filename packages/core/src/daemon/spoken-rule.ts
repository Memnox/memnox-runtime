import type { SpokenRuleDraft } from '../policy/spoken-rule';

/**
 * A rule a person says on the phone or the Mac, drafted by the daemon and read back before
 * anything is written: the phone asks again with the answers, then confirms the proposal it got.
 */

export const SPOKEN_RULE_METHOD = {
  /** One sentence drafted into a rule; with no open question left it is proposed for Touch ID or Face ID. */
  RULE: 'rule',
} as const;

/** Who drafted it, said out loud so a model's guess never reads as the grammar's reading. */
export const RULE_DRAFTED_BY = {
  PATTERN: 'pattern',
  MODEL: 'model',
} as const;

export type RuleDraftedBy = (typeof RULE_DRAFTED_BY)[keyof typeof RULE_DRAFTED_BY];

export interface SpokenRuleAnswer {
  draft: SpokenRuleDraft;
  /** The rule in plain words, to be said back before the person confirms. */
  readBack: string;
  /** What the sentence left for the person; nothing is proposed while any is open. */
  openQuestions: string[];
  draftedBy: RuleDraftedBy;
  /** Said beside a draft the workspace's grammar read, such as on a plan that drafts with no model. */
  note?: string;
  /** The proposal to confirm with the usual CONFIRM, once nothing is left open. */
  proposed?: string;
  /** Whether confirming also offers it to the team, where a second admin approves it. */
  offeredToTeam: boolean;
}

export interface SpokenRuleRequestFields {
  /** On RULE: the destinations the person named as approved, joined by commas, answering that question. */
  approved?: string;
}

export interface SpokenRuleResponseFields {
  /** On RULE, the draft and either its open questions or the proposal to confirm. */
  rule?: SpokenRuleAnswer;
  /** On a refused RULE: the workspace's plan drafts with its grammar alone, so the phone offers the upgrade. */
  upgrade?: boolean;
}
