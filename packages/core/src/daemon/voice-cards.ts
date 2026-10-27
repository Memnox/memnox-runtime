/**
 * What the Mac puts on a card for the person to read before they answer: a rule and where it
 * could hold, and a message drafted for their mail. Kept apart from the socket protocol, which
 * carries them, because each is a shape of its own that the Mac mirrors field for field.
 */
import type { DecisionEffect } from '../constants/decision.constants';

/** How a person asked: holding Control and Option says what follows is a rule they want in force. */
export const ASK_INTENT = {
  RULE: 'rule',
  /** What they asked before a sign in, asked again by the Mac once it finished, never something said just now. */
  RESUME: 'resume',
} as const;

export type AskIntent = (typeof ASK_INTENT)[keyof typeof ASK_INTENT];

/** Where a rule can be put in force: every agent on this Mac, or only inside one repository. */
export const RULE_SCOPE = {
  MACHINE: 'machine',
  REPOSITORY: 'repository',
  /** Offered to the workspace, where a second admin approves it and every agent that reads the bundle follows it. */
  TEAM: 'team',
} as const;

export type RuleScopeKind = (typeof RULE_SCOPE)[keyof typeof RULE_SCOPE];

/** One place a proposed rule can go; its id is the answer a CONFIRM signs, so the choice is covered by Touch ID. */
export interface RuleScope {
  id: string;
  kind: RuleScopeKind;
  /** "This Mac", or the repository's folder name. */
  label: string;
  /** The repository's folder, on a repository scope. */
  folder?: string;
  /** The one the person most likely meant, picked on the card until they choose another. */
  suggested?: boolean;
}

/** A proposed rule as the Mac shows it before it is confirmed: what it does, and where it could go. */
export interface RuleDraft {
  /** The rule in one plain sentence: "Deny git push to main". */
  summary: string;
  effect: DecisionEffect;
  action: string;
  branches?: string[];
  targets?: string[];
  reason: string;
  scopes: RuleScope[];
}

/** Whether a drafted message starts a thread or answers one. */
export const DRAFT_MODE = {
  COMPOSE: 'compose',
  REPLY: 'reply',
} as const;

export type DraftMode = (typeof DRAFT_MODE)[keyof typeof DRAFT_MODE];

/** The mail services a draft can go out through, once Memnox Cloud has connected one. */
export const MAIL_SERVICE = {
  GMAIL: 'gmail',
} as const;

export type MailService = (typeof MAIL_SERVICE)[keyof typeof MAIL_SERVICE];

/** A message the person's connected mail account would send, shown whole on the Mac before anything is sent. */
export interface MailDraft {
  service: MailService;
  mode: DraftMode;
  to: string[];
  cc?: string[];
  subject?: string;
  body: string;
  /** On a reply, how many messages the thread already holds. */
  thread?: number;
}
