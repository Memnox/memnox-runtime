/**
 * The workspace's memory graph as a screen draws it: what arrived from the connected tools, who said
 * it, and what the team settled out of it. Held only in memory, never written anywhere.
 */

/** What a node is, as a screen draws it. The cloud's other kinds (an agent, a path) are not memory. */
export const WORKSPACE_NODE_KIND = {
  /** A connected tool things arrive through: slack, github, notion. */
  SOURCE: 'source',
  /** One thing that arrived: a message, an issue, an uploaded file, or an address several things link to. */
  DOCUMENT: 'document',
  /** A section of something long enough to have been cut. */
  PASSAGE: 'passage',
  /** A thread or a channel, holding the messages in it. */
  CONVERSATION: 'conversation',
  PERSON: 'person',
  /** An account its tool lists as an app, which posts like somebody and is never one. */
  BOT: 'bot',
  /** A team, a department or the company, as the directory names it. */
  GROUP: 'group',
  /** A rule set in force. */
  POLICY: 'policy',
  /** Something the team settled, in force. */
  DECISION: 'decision',
  /** Something a connected tool said that nobody approved. */
  CANDIDATE: 'candidate',
} as const;

export type WorkspaceNodeKind =
  (typeof WORKSPACE_NODE_KIND)[keyof typeof WORKSPACE_NODE_KIND];

/**
 * Where a decision stands. A machine is handed only what is in force and what waits, so a superseded
 * or a rejected fact never reaches one and has no word here.
 */
export const WORKSPACE_NODE_STATUS = {
  VERIFIED: 'verified',
  CANDIDATE: 'candidate',
} as const;

export type WorkspaceNodeStatus =
  (typeof WORKSPACE_NODE_STATUS)[keyof typeof WORKSPACE_NODE_STATUS];

/** What one line says, each a field on the record. */
export const WORKSPACE_LINK_KIND = {
  /** A tool, and the thing it delivered. */
  CARRIES: 'carries',
  /** A thing, and a passage or a message inside it. */
  CONTAINS: 'contains',
  /** Who wrote a thing, and the thing; who said what a candidate was read out of. */
  SAID: 'said',
  /** A thing, and somebody it names. */
  MENTIONS: 'mentions',
  MEMBER_OF: 'member_of',
  REPORTS_TO: 'reports_to',
  /** Whoever let something in, and what they approved; who confirmed a decision. */
  APPROVED: 'approved',
  /** A thing, and what its words link to. */
  LINKS_TO: 'links_to',
  /** Two things that say something alike, proposed by comparison and stated by nobody. */
  RELATES: 'relates',
  /** A decision, and the thing it was read out of. */
  READ_FROM: 'read_from',
  /** A decision, and what it is about. */
  ABOUT: 'about',
  /** A person a fact in force says answers for something. */
  ANSWERS_FOR: 'answers_for',
  /** A decision, and the person it names as owner, approver or party. */
  NAMES: 'names',
} as const;

export type WorkspaceLinkKind =
  (typeof WORKSPACE_LINK_KIND)[keyof typeof WORKSPACE_LINK_KIND];

/** Whether the picture was read live just now or stands on the facts this machine saved. */
export const WORKSPACE_GRAPH_SOURCE = {
  LIVE: 'live',
  SAVED: 'saved',
} as const;

export type WorkspaceGraphSource =
  (typeof WORKSPACE_GRAPH_SOURCE)[keyof typeof WORKSPACE_GRAPH_SOURCE];

/** Why the saved facts stand in for the live graph. */
export const WORKSPACE_GRAPH_FALLBACK = {
  /** This machine is not connected to a workspace, or was let go. */
  NOT_JOINED: 'not-joined',
  /** The control plane did not answer in time. */
  UNREACHABLE: 'unreachable',
  /** It answered and refused, or answered with something unreadable. */
  REFUSED: 'refused',
} as const;

export type WorkspaceGraphFallback =
  (typeof WORKSPACE_GRAPH_FALLBACK)[keyof typeof WORKSPACE_GRAPH_FALLBACK];

/** One message an author posted that the cloud counted rather than drew. */
export interface WorkspaceSaid {
  label: string;
  href?: string;
  excerpt?: string;
  /** ISO time it was said. */
  at?: string;
}

export interface WorkspaceGraphNode {
  /** The cloud's ref, or `fact:` and `candidate:` with the record's id. */
  id: string;
  kind: WorkspaceNodeKind;
  label: string;
  /** The system that delivered it, in its own word: slack, github. */
  tool?: string;
  /** Where to open it. */
  href?: string;
  /** The opening of what arrived, already clipped and cleared for this machine by the cloud. */
  excerpt?: string;
  /** The words a decision or a candidate states, verbatim. */
  statement?: string;
  /** Who said it, by name, where a line on the record says so. */
  saidBy?: string;
  /** ISO time it was said, settled or seen. */
  at?: string;
  /** How many times the same person said it, or how many messages an author's mark counts. */
  count?: number;
  status?: WorkspaceNodeStatus;
  /** declared, authoritative or observed, on a decision. */
  provenance?: string;
  /** Read from somebody the workspace does not know. */
  untrusted?: true;
  /** How many lines touch it, so a screen sizes it and names only the heavy ones. */
  weight: number;
  /** The newest messages an author's count holds, only those this machine may read. */
  said?: WorkspaceSaid[];
}

export interface WorkspaceGraphLink {
  from: string;
  to: string;
  kind: WorkspaceLinkKind;
  /** candidate, observed or declared, where the record ranks the line. */
  basis?: string;
}

export interface WorkspaceGraphView {
  nodes: WorkspaceGraphNode[];
  links: WorkspaceGraphLink[];
  /** How many this machine's clearance kept back, always said, or a partial picture reads as whole. */
  withheld: number;
  /** True where the cloud cut the picture at its ceiling. */
  truncated: boolean;
  source: WorkspaceGraphSource;
  /** Why the saved facts stand in, on a saved picture only. */
  fallback?: WorkspaceGraphFallback;
  /** When the live graph was read. */
  readAt?: string;
  /** When this machine last pulled the saved facts. */
  syncedAt?: string;
}

const FACT_PREFIX = 'fact:';
const CANDIDATE_PREFIX = 'candidate:';
const SOURCE_PREFIX = 'source:';

export function workspaceFactId(id: string): string {
  return `${FACT_PREFIX}${id}`;
}

export function workspaceCandidateId(id: string): string {
  return `${CANDIDATE_PREFIX}${id}`;
}

export function workspaceSourceId(tool: string): string {
  return `${SOURCE_PREFIX}${tool}`;
}
