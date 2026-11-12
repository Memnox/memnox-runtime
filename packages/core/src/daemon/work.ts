import type { AgentWork, Tracker } from '../coordination/agent-work';

/**
 * Agent work as a person's screen starts, stops and closes it, and answers its handoffs. The issue
 * stays in its tracker; only a reference to it is kept, and no method here can be an agent's.
 */

export const WORK_METHOD = {
  /** Every piece of agent work kept here, newest change first. */
  WORK: 'agent-work',
  /** A person pointing a profile's agent at an issue: `LIN-123`, a Jira key, or an issue link. */
  WORK_START: 'work-start',
  /** A person stopping it, whatever the agent said. */
  WORK_STOP: 'work-stop',
  /** A person closing it as done, usually once the agent claimed it. */
  WORK_CLOSE: 'work-close',
  /** A person accepting or declining an agent's request to hand the work on. */
  HANDOFF_ANSWER: 'handoff-answer',
} as const;

export const HANDOFF_ANSWER_WORD = {
  ACCEPT: 'accept',
  DECLINE: 'decline',
} as const;

export type HandoffAnswerWord =
  (typeof HANDOFF_ANSWER_WORD)[keyof typeof HANDOFF_ANSWER_WORD];

export interface AgentWorkRequestFields {
  /** On WORK_START: the profile whose agent carries it, by id or name. */
  workProfile?: string;
  /** On WORK_START: the issue, as a key or its link. */
  workTarget?: string;
  /** On WORK_START: which tracker a bare key is in; Linear when left out. */
  workTracker?: Tracker;
  /** On WORK_START: a title to show beside the key, never fetched. */
  workTitle?: string;
  /** On WORK_START: the repository it is scoped to, absolute, which keeps its record there. */
  workProject?: string;
  /** On WORK_STOP and WORK_CLOSE. */
  workId?: string;
  /** On HANDOFF_ANSWER. */
  handoffId?: string;
  handoffAnswer?: HandoffAnswerWord;
}

export interface AgentWorkResponseFields {
  /** On every work method, so a screen redraws from one answer. */
  agentWork?: AgentWork[];
}

export interface AgentWorkEventFields {
  /** On WORK: the piece of work that changed, as it now stands. */
  workChanged?: AgentWork;
}
