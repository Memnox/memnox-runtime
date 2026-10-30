import type { DecisionEffect } from '../constants/decision.constants';
import { termsOf } from '../context/workspace-memory';
import type { MemoryScope } from '../projects/project';

/**
 * What this machine learned from the sources a person pointed it at: candidates a model read out
 * of them, facts a person confirmed, and the evidence each one carries. Nothing here promotes
 * itself: a model proposes and only a person's confirm makes a fact verified.
 */

export const MEMORY_STATUS = {
  /** Read out of a source, or suggested by an agent, and confirmed by nobody yet. */
  CANDIDATE: 'candidate',
  /** A person confirmed it. */
  VERIFIED: 'verified',
  /** A newer confirmed fact restates it. */
  SUPERSEDED: 'superseded',
  /** A person said no, which is remembered so it is never proposed again. */
  REJECTED: 'rejected',
  /** Every passage it was read from changed or went away. */
  OUTDATED: 'outdated',
  /** Confirmed, and another confirmed fact says the opposite, so a person decides between them. */
  CONFLICTING: 'conflicting',
} as const;

export type MemoryStatus = (typeof MEMORY_STATUS)[keyof typeof MEMORY_STATUS];

export const MEMORY_STATUSES: readonly string[] = Object.values(MEMORY_STATUS);

/** What a candidate is: something true or decided, a way of working, or a rule to enforce. */
export const MEMORY_KIND = {
  /** A fact or a decision. */
  FACT: 'fact',
  CONVENTION: 'convention',
  /** Becomes a signed rule proposal once a person confirms it. */
  RULE: 'rule',
} as const;

export type MemoryKind = (typeof MEMORY_KIND)[keyof typeof MEMORY_KIND];

export const MEMORY_KINDS: readonly string[] = Object.values(MEMORY_KIND);

/** Where an item came from: a model reading a source, an agent's suggestion, or a person. */
export const MEMORY_ORIGIN = {
  EXTRACTED: 'extracted',
  AGENT: 'agent',
  PERSON: 'person',
} as const;

export type MemoryOrigin = (typeof MEMORY_ORIGIN)[keyof typeof MEMORY_ORIGIN];

/** The rule half of a rule candidate, in the engine's own effects and patterns. */
export interface MemoryRule {
  effect: DecisionEffect;
  actions: string[];
  targets?: string[];
  agents?: string[];
  reason: string;
}

/** One place an item was read from: a file and the heading it sat under, or a link. */
export interface MemoryEvidence {
  sourceId: string;
  /** The file, relative to the source, or the document's own id at an API. */
  document: string;
  heading?: string;
  url?: string;
  /** The passage's digest when it was read, so a change to it is seen. */
  digest: string;
  /** The passage changed or went away since. */
  stale: boolean;
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  /** Verbatim as the model or the agent wrote it, never reworded here. */
  statement: string;
  subject: string;
  status: MemoryStatus;
  scope: MemoryScope;
  /** The repository a project item belongs to. */
  project?: string;
  origin: MemoryOrigin;
  /** The source it was read from, absent for an agent's suggestion. */
  sourceId?: string;
  /** Read from a source outside the person's own trust. */
  tainted: boolean;
  /** The extractor's own confidence, never the person's. */
  confidence?: number;
  /** Who suggested it, for an agent's suggestion. */
  suggestedBy?: string;
  rule?: MemoryRule;
  /** An earlier item it restates in other words. */
  duplicateOf?: string;
  /** The signed rule proposal a confirm raised and that is not settled yet. */
  proposalId?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  evidence: MemoryEvidence[];
}

/** Statuses an agent is handed as settled. */
export const SETTLED_STATUSES: readonly MemoryStatus[] = [MEMORY_STATUS.VERIFIED];

/** Statuses still waiting on a person, which the Learn queue shows. */
export const OPEN_STATUSES: readonly MemoryStatus[] = [
  MEMORY_STATUS.CANDIDATE,
  MEMORY_STATUS.CONFLICTING,
];

/** Statuses a changed passage can still move to outdated; the rest already said their last word. */
export const LIVE_STATUSES: readonly MemoryStatus[] = [
  MEMORY_STATUS.CANDIDATE,
  MEMORY_STATUS.VERIFIED,
  MEMORY_STATUS.CONFLICTING,
];

/** Two statements this close in their words are the same thing said twice. */
const RESTATED_OVERLAP = 0.8;
/** A pair this close that differ in a negation say opposite things. */
const OPPOSED_OVERLAP = 0.5;

const NEGATIONS: ReadonlySet<string> = new Set([
  'never',
  'not',
  'no',
  'dont',
  'don',
  'cannot',
  'cant',
  'mustnt',
  'shouldnt',
  'without',
  'avoid',
  'forbidden',
  'disallowed',
  'isnt',
  'arent',
  'wont',
  'doesnt',
  'didnt',
]);

/** One key per wording, so a rejection holds against the same words read again anywhere. */
export function statementKey(kind: string, statement: string): string {
  const words = statement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${kind}:${words}`;
}

/** The share of words two statements have in common, from 0 to 1. */
export function wordOverlap(a: string, b: string): number {
  const left = termsOf(a);
  const right = termsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** The same thing in nearly the same words, which the queue shows as a duplicate rather than as news. */
export function restates(a: string, b: string): boolean {
  return wordOverlap(a, b) >= RESTATED_OVERLAP && isNegated(a) === isNegated(b);
}

/**
 * Two confirmed facts about the same subject that say opposite things: close in their words and
 * one negated where the other is not. A heuristic, so it only ever flags for a person to decide.
 */
export function disagrees(a: MemoryItem, b: MemoryItem): boolean {
  if (a.id === b.id || a.kind === MEMORY_KIND.RULE || b.kind === MEMORY_KIND.RULE)
    return false;
  if (!sameSubject(a.subject, b.subject)) return false;
  if (isNegated(a.statement) === isNegated(b.statement)) return false;
  return wordOverlap(a.statement, b.statement) >= OPPOSED_OVERLAP;
}

function sameSubject(a: string, b: string): boolean {
  const left = [...termsOf(a)].sort().join(' ');
  return left !== '' && left === [...termsOf(b)].sort().join(' ');
}

function isNegated(statement: string): boolean {
  const words = statement
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z]+/);
  return words.some((word) => NEGATIONS.has(word));
}

/** An item whose every piece of evidence went stale says nothing current any more. */
export function isOutdated(item: Pick<MemoryItem, 'evidence'>): boolean {
  return item.evidence.length > 0 && item.evidence.every((each) => each.stale);
}

/** Where the evidence sits, as a person reads it: `notes/ops.md, "Releases"`, or the link. */
export function evidenceRef(
  evidence: Pick<MemoryEvidence, 'document' | 'heading' | 'url'>,
): string {
  if (evidence.url !== undefined) return evidence.url;
  return evidence.heading === undefined
    ? evidence.document
    : `${evidence.document}#${evidence.heading}`;
}
