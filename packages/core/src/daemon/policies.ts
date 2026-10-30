import type { DecisionEffect } from '../constants/decision.constants';
import type { AutonomyLevel } from '../session/autonomy';
import type { RuleDraft } from './voice-cards';

/**
 * The Policy Studio as every screen reads and changes it: the rules in force and where each came
 * from, a rule proposed field by field, a dry run, packs, and how far the agents have been let go.
 */

export const POLICY_METHOD = {
  /** Every rule in force on this machine, with where it came from and what would not load. */
  POLICY_RULES: 'rules',
  /** A rule filled in on a form; it holds only once the person signs the proposal it raises. */
  RULE_PROPOSE: 'rule-propose',
  /** Removing a person's rule: an allow goes at once, a deny or an ask waits on a signature. */
  RULE_REMOVE: 'rule-remove',
  /** One action ruled on against the rules in force, recording and changing nothing. */
  RULE_TEST: 'rule-test',
  /** The rules a person added here, as TOML text. */
  RULES_EXPORT: 'rules-export',
  /** A pack of rules as TOML, each turned into its own signed proposal. */
  RULE_PACK_IMPORT: 'rule-pack-import',
  /** The packs Memnox ships, each offered whole and imported through RULE_PACK_IMPORT. */
  RULE_PACKS: 'rule-packs',
  /** What could be handed over, what the autopilot holds, and where the machine stands. */
  PROGRESS: 'progress',
  /** Takes one autopilot grant back at once, since that only narrows. */
  AUTOPILOT_REVOKE: 'autopilot-revoke',
} as const;

/** Where a rule in force came from. */
export const RULE_SOURCE = {
  /** A person added it on this machine, by voice, a form or a hand over. */
  PERSON: 'person',
  /** A rule file in a repository, the person's to edit and commit. */
  FILE: 'file',
  /** Published by the workspace and pulled here; nothing on this machine loosens it. */
  WORKSPACE: 'workspace',
  /** The baseline setup wrote. */
  DEFAULT: 'default',
  /** Handed to one agent by the autopilot, for a while. */
  AUTOPILOT: 'autopilot',
  /** Allowed for a while with `memnox allow`. */
  ALLOWANCE: 'allowance',
  /** A pause or a freeze in force, which ends on its own. */
  FREEZE: 'freeze',
  /** Read out of the person's notes, confirmed in Learn and signed; it names where it was read. */
  EXTRACTED: 'extracted',
} as const;

export type RuleSource = (typeof RULE_SOURCE)[keyof typeof RULE_SOURCE];

/** What a rule matches; an absent list matches anything. */
export interface PolicyRuleMatch {
  actions: string[];
  targets?: string[];
  agents?: string[];
  workingDirectories?: string[];
  classes?: string[];
  branches?: string[];
}

export interface PolicyRuleView {
  name: string;
  effect: DecisionEffect;
  match: PolicyRuleMatch;
  reason?: string;
  /** The rule in one plain sentence, to read before the fields. */
  sentence: string;
  source: RuleSource;
  /** The file it was read from, where it lives in one. */
  file?: string;
  /** On a workspace rule: who decided it, and when. */
  decidedBy?: string;
  decidedAt?: string;
  /** On an extracted rule: where it was read, as `path#heading` or a link. */
  evidenceRefs?: string[];
  /** When it ends on its own, for a grant, an allowance or a freeze. */
  until?: string;
  /** Only a rule a person added on this machine, which is the only kind a screen removes. */
  editable: boolean;
}

/** A rule file that is there and will not load, so its rules are not in force. */
export interface PolicyLoadProblem {
  file: string;
  issues: string[];
}

export interface PolicyRulesView {
  rules: PolicyRuleView[];
  problems: PolicyLoadProblem[];
  /** Registered files that are gone. */
  missing: string[];
}

/** A rule as a form fills it in, before the daemon reads it back and offers where it holds. */
export type RuleDraftInput = Omit<RuleDraft, 'summary' | 'scopes'>;

/** One action to rule on, the way `memnox policy test` takes it. */
export interface RuleTestInput {
  /** A command line, or an action named outright such as `git.push`. */
  action: string;
  target?: string;
  agent?: string;
  workingDirectory?: string;
}

export interface RuleVerdictView {
  effect: DecisionEffect;
  reason: string;
  /** The rule that decided, by name; absent when the default did. */
  rule?: string;
  /** What to do instead, where the rule names a way forward. */
  instead?: string;
}

/** An action a person approved often enough, with nothing arguing against handing it over. */
export interface ProgressReady {
  action: string;
  approvals: number;
  targets: string[];
  because: string;
}

/** Approved, never refused, and not yet often enough. */
export interface ProgressAlmost {
  action: string;
  approvals: number;
  /** Approvals still to go before it is ready. */
  needed: number;
}

/** A grant the autopilot made and that still stands. */
export interface ProgressGrant {
  id: string;
  actions: string[];
  targets: string[];
  agents: string[];
  since: string;
  until: string;
  says: string;
}

/** Where the machine stands on the autonomy ladder, and what the next rung asks for. */
export interface ProgressLadder {
  level: AutonomyLevel;
  says: string;
  rungs: AutonomyLevel[];
  next?: AutonomyLevel;
  /** What the record has to show before the next rung, in a sentence. */
  needs?: string;
  actionsThisWeek: number;
  asksThisWeek: number;
  /** Actions in a week before the top two rungs can be claimed. */
  minimumEvidence: number;
}

/** One week in counts, never hours saved. */
export interface ProgressWeek {
  from: string;
  asked: number;
  /** Allowed by an autopilot grant rather than by a person. */
  answeredByAutopilot: number;
  /** Grants the autopilot made in the week. */
  handedOver: number;
}

export interface ProgressView {
  ready: ProgressReady[];
  almost: ProgressAlmost[];
  grants: ProgressGrant[];
  autopilotOn: boolean;
  ladder: ProgressLadder;
  thisWeek: ProgressWeek;
  lastWeek: ProgressWeek;
}

/** A pack Memnox ships, with its TOML to hand straight to RULE_PACK_IMPORT. */
export interface RulePackView {
  /** The file it ships as, without its extension, which stays the same between releases. */
  id: string;
  name: string;
  description: string;
  ruleCount: number;
  toml: string;
}

export interface PolicyRequestFields {
  /** On RULE_PROPOSE. */
  ruleDraft?: RuleDraftInput;
  /** On RULE_REMOVE: the rule, by name. */
  ruleName?: string;
  /** On RULE_TEST. */
  ruleTest?: RuleTestInput;
  /** On RULE_PACK_IMPORT: the pack as TOML text. */
  rulePack?: string;
  /** On AUTOPILOT_REVOKE: the grant, by id. */
  grantId?: string;
}

export interface PolicyResponseFields {
  /** On POLICY_RULES, and after every change, so a screen redraws from one answer. */
  policyRules?: PolicyRulesView;
  /** On RULE_PROPOSE: the rule read back, with where it could hold. */
  ruleProposed?: RuleDraft;
  /** On RULE_TEST. */
  ruleVerdict?: RuleVerdictView;
  /** On RULES_EXPORT. */
  rulesToml?: string;
  /** On RULE_PACK_IMPORT: one proposal per rule, each confirmed on its own. */
  packProposed?: string[];
  /** On PROGRESS and AUTOPILOT_REVOKE. */
  progress?: ProgressView;
  /** On RULE_PACKS. */
  rulePacks?: RulePackView[];
}
