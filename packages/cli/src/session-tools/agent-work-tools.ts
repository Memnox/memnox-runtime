import {
  AgentWorks,
  agentIdFor,
  isFinished,
  profileIdFor,
  REF_KIND,
  SESSION_VAR,
  WORK_STATUS,
  withHandoffRequest,
  withProgress,
  type AgentWork,
  type RefKind,
  type WorkOutcome,
  type WorkRef,
  type WorkStatus,
} from '@memnox/core';
import { readBindings } from '../agents/connections';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * The agent's side of the work a person pointed it at: read it, say how it is going, say it is
 * blocked, or ask to hand it on. Nothing here starts, assigns, stops or closes work.
 */

// Each adds a line to the work's record, which changes nothing the agent may do.
const REPORTS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const WORK_ARG = {
  type: 'string',
  description: 'the work id my_work gave; your one open piece of work when left out',
} as const;

const REFS_ARG = {
  type: 'string',
  description: `references, comma separated, each kind:id with kind one of ${Object.values(REF_KIND).join(', ')}, such as "commit:4f2a9c,pr:17"`,
} as const;

export const AGENT_WORK_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'my_work',
    description:
      'The work your person pointed you at: the issue in their tracker, its status, the latest progress and any handoff waiting. Read the issue itself in the tracker; Memnox keeps only a reference to it.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'report_progress',
    description:
      'Say in one line how your work is going, for your person. Pass state done_claimed when you think it is finished; only your person closes it.',
    inputSchema: {
      type: 'object',
      properties: {
        work: WORK_ARG,
        note: { type: 'string', description: 'what happened, in at most 500 characters' },
        state: {
          type: 'string',
          description: 'active or done_claimed; unchanged when left out',
        },
        refs: REFS_ARG,
      },
    },
    annotations: REPORTS,
  },
  {
    name: 'mark_blocked',
    description: 'Say your work is blocked and why, so your person sees it needs them.',
    inputSchema: {
      type: 'object',
      properties: {
        work: WORK_ARG,
        note: { type: 'string', description: 'what it is waiting on' },
        refs: REFS_ARG,
      },
    },
    annotations: REPORTS,
  },
  {
    name: 'request_handoff',
    description:
      'Ask your person to hand your work to another agent profile or to a person. Nothing moves until they accept; the next agent reads each reference through its own access.',
    inputSchema: {
      type: 'object',
      properties: {
        work: WORK_ARG,
        to_profile: { type: 'string', description: 'the agent profile to hand it to' },
        to_person: { type: 'string', description: 'or the person to hand it to' },
        reason: { type: 'string', description: 'why, in a sentence' },
        refs: REFS_ARG,
      },
    },
    annotations: REPORTS,
  },
];

/** The work this agent's profile carries and has not finished, its own session's first. */
async function myWork(deps: SessionToolDeps): Promise<AgentWork[]> {
  const profileId = profileIdFor(
    agentIdFor(deps.agent),
    deps.agent,
    await readBindings(deps.home),
  );
  const session = deps.env[SESSION_VAR];
  const open = (await new AgentWorks(deps.home).all()).filter(
    (each) => each.profileId === profileId && !isFinished(each),
  );
  return [
    ...open.filter((each) => session !== undefined && each.sessions.includes(session)),
    ...open.filter((each) => session === undefined || !each.sessions.includes(session)),
  ];
}

export async function myWorkTool(deps: SessionToolDeps): Promise<unknown> {
  const works = await myWork(deps);
  if (works.length === 0)
    return { work: [], note: 'Your person has pointed you at no work.' };
  return {
    work: works.map((each) => ({
      id: each.id,
      issue: each.target,
      status: each.status,
      responsiblePerson: each.responsiblePerson,
      latest: each.progress.at(-1)?.note,
      handoffWaiting: each.handoffs.some((handoff) => handoff.state === 'requested'),
    })),
  };
}

/** One piece of the agent's own work changed and kept, or why not. */
async function changeMine(
  deps: SessionToolDeps,
  args: ToolArgs,
  change: (work: AgentWork, at: string) => WorkOutcome,
): Promise<unknown> {
  const works = await myWork(deps);
  const named = textArg(args, 'work');
  const work =
    named === undefined
      ? works.length === 1
        ? works[0]
        : undefined
      : works.find((each) => each.id === named);
  if (work === undefined)
    return {
      refused:
        named === undefined
          ? 'Name the work; my_work lists yours.'
          : `${named} is not work your person pointed you at.`,
    };
  const outcome = change(work, deps.now().toISOString());
  if ('refused' in outcome) return outcome;
  await new AgentWorks(deps.home).write(outcome.work);
  return { work: outcome.work.id, status: outcome.work.status };
}

function refsArg(args: ToolArgs): WorkRef[] {
  const kinds: readonly string[] = Object.values(REF_KIND);
  return (textArg(args, 'refs') ?? '').split(',').flatMap((each) => {
    const [kind, ...rest] = each.trim().split(':');
    const id = rest.join(':');
    // Cast is safe: checked against every kind on the same line.
    return kind !== undefined && kinds.includes(kind) && id !== ''
      ? [{ kind: kind as RefKind, id }]
      : [];
  });
}

function stateArg(args: ToolArgs): WorkStatus | undefined {
  const state = textArg(args, 'state');
  if (state === WORK_STATUS.DONE_CLAIMED) return WORK_STATUS.DONE_CLAIMED;
  if (state === WORK_STATUS.ACTIVE) return WORK_STATUS.ACTIVE;
  return undefined;
}

function byOf(deps: SessionToolDeps): string {
  return deps.env[SESSION_VAR] ?? agentIdFor(deps.agent);
}

export function reportProgressTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const state = stateArg(args);
  return changeMine(deps, args, (work, at) =>
    withProgress(work, {
      at,
      by: byOf(deps),
      note: textArg(args, 'note') ?? '',
      ...(state === undefined ? {} : { state }),
      refs: refsArg(args),
    }),
  );
}

export function markBlockedTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  return changeMine(deps, args, (work, at) =>
    withProgress(work, {
      at,
      by: byOf(deps),
      note: textArg(args, 'note') ?? 'blocked',
      state: WORK_STATUS.BLOCKED,
      refs: refsArg(args),
    }),
  );
}

export function requestHandoffTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const profileId = textArg(args, 'to_profile');
  const person = textArg(args, 'to_person');
  return changeMine(deps, args, (work, at) =>
    withHandoffRequest(work, {
      to: {
        ...(profileId === undefined ? {} : { profileId }),
        ...(person === undefined ? {} : { person }),
      },
      reason: textArg(args, 'reason') ?? '',
      refs: refsArg(args),
      at,
    }),
  );
}

/** Each work tool by name, so the session server answers them in one place. */
export const AGENT_WORK_CALLS: Readonly<
  Record<string, (deps: SessionToolDeps, args: ToolArgs) => Promise<unknown>>
> = {
  my_work: (deps) => myWorkTool(deps),
  report_progress: reportProgressTool,
  mark_blocked: markBlockedTool,
  request_handoff: requestHandoffTool,
};
