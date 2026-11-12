import {
  DAEMON_METHOD,
  HANDOFF_ANSWER_WORD,
  isTracker,
  type DaemonRequest,
} from '@memnox/core';
import { workAnswer } from '../daemon/work-answer';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * The voice acting on agent work for the person it speaks for and nobody else: pointing an agent
 * at an issue after a yes read back, showing the work, and passing on their answer to a handoff.
 */

// Each changes who carries a piece of work, which grants the agent nothing it did not have.
const STEERS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const OPERATOR_WORK_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'start_agent_work',
    description:
      'Point the agent under a profile at an issue in the person\'s tracker, like "have the coder take LIN-123". Read back which agent and which issue first, and call this only after their yes, as with send_instruction. Memnox keeps a reference to the issue, never a copy.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'the agent profile, by name or id' },
        issue: {
          type: 'string',
          description: 'the key, such as LIN-123, or the issue link',
        },
        tracker: {
          type: 'string',
          description: 'linear, jira, github or asana, for a bare key',
        },
        title: { type: 'string', description: 'the title, as the person said it' },
      },
    },
    annotations: STEERS,
  },
  {
    name: 'show_agent_work',
    description:
      'What each agent is working on: the issue, its status, the latest progress note, and any handoff waiting on the person.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'answer_handoff',
    description:
      "Pass on the person's answer to an agent asking to hand its work on, which you will have just read to them. accept moves the work as asked; decline keeps it where it is. Their answer is their choice, so it goes at once.",
    inputSchema: {
      type: 'object',
      properties: {
        handoff: { type: 'string', description: 'the handoff id, from show_agent_work' },
        answer: { type: 'string', description: 'accept or decline' },
      },
    },
    annotations: STEERS,
  },
];

function ask(deps: SessionToolDeps, request: Partial<DaemonRequest>): Promise<unknown> {
  return workAnswer(
    deps.home,
    // Cast is safe: the method is set here and every other field is optional.
    { id: 1, method: DAEMON_METHOD.WORK, ...request } as DaemonRequest,
    { now: deps.now() },
  ).then((answer) =>
    answer.ok
      ? { ok: true, work: answer.agentWork ?? [] }
      : { ok: false, refused: answer.error },
  );
}

function startAgentWork(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const tracker = textArg(args, 'tracker');
  const title = textArg(args, 'title');
  return ask(deps, {
    method: DAEMON_METHOD.WORK_START,
    ...withText('workProfile', textArg(args, 'profile')),
    ...withText('workTarget', textArg(args, 'issue')),
    ...(tracker !== undefined && isTracker(tracker) ? { workTracker: tracker } : {}),
    ...withText('workTitle', title),
  });
}

function answerHandoff(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const answer = textArg(args, 'answer');
  if (answer !== HANDOFF_ANSWER_WORD.ACCEPT && answer !== HANDOFF_ANSWER_WORD.DECLINE)
    return Promise.resolve({ ok: false, refused: 'Say accept or decline.' });
  return ask(deps, {
    method: DAEMON_METHOD.HANDOFF_ANSWER,
    ...withText('handoffId', textArg(args, 'handoff')),
    handoffAnswer: answer,
  });
}

function withText<TKey extends string>(
  key: TKey,
  value: string | undefined,
): Partial<Record<TKey, string>> {
  // Cast is safe: the one key is set to the text that was given.
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, string>);
}

export const OPERATOR_WORK_CALLS: Record<string, OperatorCall> = {
  start_agent_work: (deps, _seams, args) => startAgentWork(deps, args),
  show_agent_work: (deps) => ask(deps, { method: DAEMON_METHOD.WORK }),
  answer_handoff: (deps, _seams, args) => answerHandoff(deps, args),
};
