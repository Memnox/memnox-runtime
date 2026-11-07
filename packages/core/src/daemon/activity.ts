import type { DecisionEffect } from '../constants/decision.constants';
import type { ContextPart } from '../ledger/action-context';
import type { RuleSource } from './policies';

/**
 * The ledger as a screen pages through it: what agents did and what was decided, names only and
 * never arguments or file contents, one decision opened whole, and a period exported signed.
 */

export const ACTIVITY_METHOD = {
  /** One page of the ledger, newest first, filtered and bounded. */
  ACTIVITY: 'activity',
  /** One decision whole: its rule, who handed the work down, what led up to it, and the trace. */
  DECISION: 'decision',
  /** The rows a filter selects, as a signed bundle an auditor can check. */
  ACTIVITY_EXPORT: 'activity-export',
} as const;

/** What kind of thing an agent did, as a filter names it. */
export const ACTIVITY_KIND = {
  TOOL: 'tool',
  COMMAND: 'command',
  FILE: 'file',
  MCP: 'mcp',
} as const;

export type ActivityKind = (typeof ACTIVITY_KIND)[keyof typeof ACTIVITY_KIND];

/** How a held call was let through. */
export const ANSWERED_HOW = {
  /** With Touch ID or Face ID. */
  SIGNED: 'signed',
  /** On the Mac, for a call that stayed inside its session's repository. */
  WITHIN_SESSION: 'within-session',
  /** By voice, in a terminal, or any route that names itself otherwise. */
  OTHER: 'other',
} as const;

export type AnsweredHow = (typeof ANSWERED_HOW)[keyof typeof ANSWERED_HOW];

export interface ActivityFilter {
  effect?: DecisionEffect;
  /** The agent's kind, such as claude-code. */
  agent?: string;
  kind?: ActivityKind;
  /** Matched against the operation, the target and the rule's name, never arguments. */
  text?: string;
  /** ISO 8601; only rows at or after it. */
  since?: string;
  /** ISO 8601; only rows at or before it. */
  until?: string;
}

export interface ActivityRow {
  id: string;
  at: string;
  agent: string;
  agentName: string;
  session: string;
  kind: ActivityKind;
  operation: string;
  target?: string;
  effect: DecisionEffect;
  /** What enforce would have said, where the mode kept it from being applied. */
  shadowEffect?: DecisionEffect;
  rule?: string;
  reason: string;
  answeredBy?: string;
  answeredHow?: AnsweredHow;
  /** The exit code, where it ran and failed. */
  failed?: number;
}

export interface ActivityPage {
  rows: ActivityRow[];
  /** Hand back as `activityCursor` for the next page; absent on the last. */
  nextCursor?: string;
}

/** The rule that decided, as it stands now beside what the row recorded. */
export interface DecisionRule {
  name: string;
  file?: string;
  line?: number;
  source?: RuleSource;
  decidedBy?: string;
  decidedAt?: string;
  /** The workspace has published newer rules since this was decided. */
  newerSince?: boolean;
}

/** One step the session took just before, names only. */
export interface DecisionStep {
  at: string;
  operation: string;
  target?: string;
  effect: DecisionEffect;
}

/** The ledger's own account of the action, as `memnox trace` prints it. */
export interface DecisionTrace {
  mode: string;
  exitCode?: number;
  durationMs?: number;
  approvedBy?: string;
  argsDigest?: string;
  outputDigest?: string;
}

export interface DecisionView {
  row: ActivityRow;
  rule?: DecisionRule;
  /** Who handed the work down, as one line: person, agent, helper. */
  chain: string;
  context: ContextPart[];
  /** The task somebody declared for the session, where one was. */
  task?: string;
  before: DecisionStep[];
  alternative?: string;
  trace: DecisionTrace;
}

/** One row as it is written, for a live timeline: names only, never arguments, output or contents. */
export interface LiveActivityRow {
  id: string;
  at: string;
  /** The agent's kind, such as claude-code. */
  agent: string;
  operation: string;
  effect: DecisionEffect;
  /** The target by name: a path, a host, a server; never what was sent to it. */
  target?: string;
}

/** The most rows one ACTIVITY event carries; the rest of a burst is counted, and a screen pages for it. */
export const MOST_LIVE_ACTIVITY_ROWS = 20;

export interface ActivityEventFields {
  /** On ACTIVITY: the rows written since the last one, oldest first. */
  activityRows?: LiveActivityRow[];
  /** On ACTIVITY: rows of the same burst this event does not carry, at least this many. */
  activityMissed?: number;
}

export interface ActivityRequestFields {
  /** On ACTIVITY and ACTIVITY_EXPORT. */
  activityFilter?: ActivityFilter;
  /** On ACTIVITY: where the last page ended. */
  activityCursor?: string;
  /** On ACTIVITY: rows wanted, capped by the daemon. */
  activityLimit?: number;
  /** On DECISION: the row, by id. */
  decisionId?: string;
}

export interface ActivityResponseFields {
  /** On ACTIVITY. */
  activity?: ActivityPage;
  /** On DECISION. */
  decision?: DecisionView;
  /** On ACTIVITY_EXPORT: the signed header as one JSON line, then one event per line. */
  activityBundle?: string;
}
