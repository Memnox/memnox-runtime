import { randomUUID } from 'node:crypto';
import type { SessionTask } from '../session/session-task';

/**
 * An agent carrying a piece of work a person pointed it at. The work itself lives in Linear, Jira,
 * GitHub or Asana and is only referenced here, never copied. A person starts, stops and closes it.
 */

/** Never `wrk_`, which a workspace brief already answers to in `work`. */
const WORK_ID_PREFIX = 'agw_';
const HANDOFF_ID_PREFIX = 'hnd_';

/** A progress note is a line for a person, not a report, so it stays this short. */
export const MOST_PROGRESS_CHARS = 500;
/** Past this the oldest notes go, so a long piece of work cannot grow its file without end. */
export const MOST_PROGRESS_NOTES = 50;
const MOST_REFS = 20;

export const TRACKER = {
  LINEAR: 'linear',
  JIRA: 'jira',
  GITHUB: 'github',
  ASANA: 'asana',
} as const;

export type Tracker = (typeof TRACKER)[keyof typeof TRACKER];

/** The tracker's own issue, named and never duplicated: its title is a label, not a copy. */
export interface ExternalTaskRef {
  source: Tracker;
  /** `LIN-123`, `PAY-42`, `acme/api#17` or an Asana task id. */
  externalId: string;
  url?: string;
  title?: string;
}

export const WORK_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  HANDOFF_REQUESTED: 'handoff_requested',
  /** The agent says it is done; only a person closes it. */
  DONE_CLAIMED: 'done_claimed',
  DONE: 'done',
  STOPPED: 'stopped',
} as const;

export type WorkStatus = (typeof WORK_STATUS)[keyof typeof WORK_STATUS];

const FINISHED: readonly WorkStatus[] = [WORK_STATUS.DONE, WORK_STATUS.STOPPED];

/** Context moves by reference: the reader opens each one through its own clearance. */
export const REF_KIND = {
  FACT: 'fact',
  EVENT: 'event',
  COMMIT: 'commit',
  PR: 'pr',
  FILE: 'file',
  LEASE: 'lease',
  SESSION: 'session',
} as const;

export type RefKind = (typeof REF_KIND)[keyof typeof REF_KIND];

export interface WorkRef {
  kind: RefKind;
  id: string;
}

export interface WorkProgress {
  at: string;
  /** The session or agent that said it, never a person, who closes or stops instead. */
  by: string;
  note: string;
  state?: WorkStatus;
  refs: WorkRef[];
}

/** One side of a handoff: an agent by its profile, or a person. */
export interface HandoffParty {
  profileId?: string;
  person?: string;
}

export const HANDOFF_STATE = {
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
} as const;

export type HandoffState = (typeof HANDOFF_STATE)[keyof typeof HANDOFF_STATE];

export interface WorkHandoff {
  id: string;
  from: HandoffParty;
  to: HandoffParty;
  reason: string;
  refs: WorkRef[];
  state: HandoffState;
  requestedAt: string;
  /** The person who answered, and only a person ever does. */
  decidedBy?: string;
  decidedAt?: string;
}

export interface AgentWork {
  id: string;
  profileId: string;
  /** Who answers for this work: asks go to them, and the agent never holds their authority. */
  responsiblePerson: string;
  /** The person who pointed the agent at it, where that is someone else. */
  assignedBy?: string;
  target: ExternalTaskRef;
  /** The repository it is scoped to, absolute, which keeps the record in that project. */
  projectRoot?: string;
  sessions: string[];
  /** How many agents have carried it: one at the start, one more per accepted handoff. */
  attempts: number;
  status: WorkStatus;
  progress: WorkProgress[];
  handoffs: WorkHandoff[];
  createdAt: string;
  updatedAt: string;
}

/** What a person names when they start work. */
export interface WorkStart {
  profileId: string;
  responsiblePerson: string;
  assignedBy?: string;
  target: ExternalTaskRef;
  projectRoot?: string;
}

export function startedWork(start: WorkStart, now: string): AgentWork {
  return {
    id: `${WORK_ID_PREFIX}${randomUUID()}`,
    profileId: start.profileId,
    responsiblePerson: start.responsiblePerson,
    ...(start.assignedBy === undefined ? {} : { assignedBy: start.assignedBy }),
    target: start.target,
    ...(start.projectRoot === undefined ? {} : { projectRoot: start.projectRoot }),
    sessions: [],
    attempts: 1,
    status: WORK_STATUS.ACTIVE,
    progress: [],
    handoffs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isFinished(work: Pick<AgentWork, 'status'>): boolean {
  return FINISHED.includes(work.status);
}

/** Only these states are an agent's to report; done and stopped are a person's. */
const AGENT_STATES: readonly WorkStatus[] = [
  WORK_STATUS.ACTIVE,
  WORK_STATUS.BLOCKED,
  WORK_STATUS.DONE_CLAIMED,
];

export type WorkOutcome = { work: AgentWork } | { refused: string };

/** What an agent may say about its work: a note, and blocked, carrying on, or claiming it done. */
export function withProgress(
  work: AgentWork,
  progress: Omit<WorkProgress, 'refs'> & { refs?: readonly WorkRef[] },
): WorkOutcome {
  if (isFinished(work)) return { refused: 'That work is finished; a person reopens it.' };
  if (progress.state !== undefined && !AGENT_STATES.includes(progress.state))
    return {
      refused: `An agent reports ${AGENT_STATES.join(', ')}; a person closes work.`,
    };
  const note = progress.note.trim().slice(0, MOST_PROGRESS_CHARS);
  if (note === '') return { refused: 'Say what happened in a line.' };
  const entry: WorkProgress = {
    at: progress.at,
    by: progress.by,
    note,
    ...(progress.state === undefined ? {} : { state: progress.state }),
    refs: refsOf(progress.refs),
  };
  return {
    work: {
      ...work,
      status: progress.state ?? work.status,
      progress: [...work.progress, entry].slice(-MOST_PROGRESS_NOTES),
      updatedAt: progress.at,
    },
  };
}

/** An agent asking to hand on; nothing moves until a person answers. */
export function withHandoffRequest(
  work: AgentWork,
  ask: { to: HandoffParty; reason: string; refs?: readonly WorkRef[]; at: string },
): WorkOutcome {
  if (isFinished(work)) return { refused: 'That work is finished; a person reopens it.' };
  if (ask.to.profileId === undefined && ask.to.person === undefined)
    return { refused: 'Name the agent profile or the person to hand it to.' };
  if (work.handoffs.some((each) => each.state === HANDOFF_STATE.REQUESTED))
    return { refused: 'A handoff is already waiting on a person.' };
  const handoff: WorkHandoff = {
    id: `${HANDOFF_ID_PREFIX}${randomUUID()}`,
    from: { profileId: work.profileId },
    to: ask.to,
    reason: ask.reason.trim().slice(0, MOST_PROGRESS_CHARS),
    refs: refsOf(ask.refs),
    state: HANDOFF_STATE.REQUESTED,
    requestedAt: ask.at,
  };
  return {
    work: {
      ...work,
      status: WORK_STATUS.HANDOFF_REQUESTED,
      handoffs: [...work.handoffs, handoff],
      updatedAt: ask.at,
    },
  };
}

/** A person's answer: accepted moves the work to the agent or person named; declined leaves it. */
export function withHandoffAnswer(
  work: AgentWork,
  answer: { handoffId: string; accepted: boolean; by: string; at: string },
): WorkOutcome {
  const handoff = work.handoffs.find((each) => each.id === answer.handoffId);
  if (handoff === undefined || handoff.state !== HANDOFF_STATE.REQUESTED)
    return { refused: 'No handoff waits under that id.' };
  const decided: WorkHandoff = {
    ...handoff,
    state: answer.accepted ? HANDOFF_STATE.ACCEPTED : HANDOFF_STATE.DECLINED,
    decidedBy: answer.by,
    decidedAt: answer.at,
  };
  const moved = answer.accepted ? movedTo(work, handoff.to) : {};
  return {
    work: {
      ...work,
      ...moved,
      status: WORK_STATUS.ACTIVE,
      handoffs: work.handoffs.map((each) => (each.id === decided.id ? decided : each)),
      updatedAt: answer.at,
    },
  };
}

function movedTo(work: AgentWork, to: HandoffParty): Partial<AgentWork> {
  return {
    ...(to.profileId === undefined
      ? {}
      : { profileId: to.profileId, attempts: work.attempts + 1 }),
    ...(to.person === undefined ? {} : { responsiblePerson: to.person }),
  };
}

/** A person ending it: done once the agent's claim is checked, or stopped at any point. */
export function finishedWork(
  work: AgentWork,
  how: { status: typeof WORK_STATUS.DONE | typeof WORK_STATUS.STOPPED; at: string },
): WorkOutcome {
  if (isFinished(work)) return { refused: 'That work is already finished.' };
  return { work: { ...work, status: how.status, updatedAt: how.at } };
}

/** A session started under the work's profile joins it once, so the record names every session. */
export function joinedBy(work: AgentWork, sessionId: string, at: string): AgentWork {
  if (work.sessions.includes(sessionId)) return work;
  return { ...work, sessions: [...work.sessions, sessionId], updatedAt: at };
}

/** The task a session under this work is held to, so drift is measured against what was asked. */
export function sessionTaskOfWork(
  work: AgentWork,
  sessionId: string,
  now: string,
): SessionTask {
  const named = work.target.title === undefined ? '' : `: ${work.target.title}`;
  return {
    id: `tsk_${work.id.slice(WORK_ID_PREFIX.length, WORK_ID_PREFIX.length + 12)}`,
    sessionId,
    statement: `${work.target.externalId}${named}`,
    scope: work.projectRoot === undefined ? {} : { paths: [`${work.projectRoot}/**`] },
    declaredAt: now,
    declaredBy: 'work',
  };
}

function refsOf(refs: readonly WorkRef[] | undefined): WorkRef[] {
  const kinds: readonly string[] = Object.values(REF_KIND);
  return (refs ?? [])
    .filter((each) => kinds.includes(each.kind) && each.id.trim() !== '')
    .slice(0, MOST_REFS)
    .map((each) => ({ kind: each.kind, id: each.id.trim() }));
}
