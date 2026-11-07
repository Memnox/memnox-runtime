/** `memnox work` and `memnox handoff`: each sends the daemon's own work method and draws its answer. */
import {
  DAEMON_METHOD,
  HANDOFF_ANSWER_WORD,
  isTracker,
  type AgentWork,
  type DaemonRequest,
  type DaemonResponse,
  type HandoffAnswerWord,
} from '@memnox/core';
import type { CliContext } from '../../cli-context';
import { workAnswer } from '../../daemon/work-answer';

export interface WorkDeps {
  context: CliContext;
  home: () => string;
  now?: () => Date;
}

export interface StartOptions {
  tracker?: string;
  title?: string;
  project?: string;
}

function ask(deps: WorkDeps, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  return workAnswer(
    deps.home(),
    // Cast is safe: the method is set here and every other field is optional.
    { id: 1, method: DAEMON_METHOD.WORK, ...request } as DaemonRequest,
    { now: (deps.now ?? ((): Date => new Date()))() },
  );
}

function failed(deps: WorkDeps, answer: DaemonResponse): boolean {
  if (answer.ok) return false;
  deps.context.flow.fail(answer.error ?? 'Memnox could not do that.');
  process.exitCode = 1;
  return true;
}

export async function runStartWork(
  deps: WorkDeps,
  input: { profile: string; target: string },
  options: StartOptions,
): Promise<void> {
  deps.context.flow.open('memnox work start');
  if (options.tracker !== undefined && !isTracker(options.tracker))
    throw new Error(
      `"${options.tracker}" is not a tracker: linear, jira, github or asana.`,
    );
  const answer = await ask(deps, {
    method: DAEMON_METHOD.WORK_START,
    workProfile: input.profile,
    workTarget: input.target,
    ...(options.tracker !== undefined && isTracker(options.tracker)
      ? { workTracker: options.tracker }
      : {}),
    ...(options.title === undefined ? {} : { workTitle: options.title }),
    ...(options.project === undefined ? {} : { workProject: options.project }),
  });
  if (failed(deps, answer)) return;
  const [started] = answer.agentWork ?? [];
  if (started !== undefined) renderWork(deps, started);
  deps.context.flow.close(
    'A session of that agent joins it on a branch named for the issue, or with memnox run --work.',
  );
}

export async function runListWork(deps: WorkDeps): Promise<void> {
  const { flow } = deps.context;
  flow.open('memnox work list');
  const answer = await ask(deps, { method: DAEMON_METHOD.WORK });
  if (failed(deps, answer)) return;
  const works = answer.agentWork ?? [];
  flow.list(
    'Agent work',
    works.map((each) => ({
      text: `${each.id}  ${each.target.externalId}  ${each.status}`,
      detail: [`carried by ${each.profileId}, answered for by ${each.responsiblePerson}`],
    })),
  );
  flow.close(works.length === 0 ? 'No agent work yet.' : `${works.length} in all.`);
}

export async function runShowWork(deps: WorkDeps, id: string): Promise<void> {
  deps.context.flow.open('memnox work show');
  const answer = await ask(deps, { method: DAEMON_METHOD.WORK });
  if (failed(deps, answer)) return;
  const work = (answer.agentWork ?? []).find((each) => each.id === id);
  if (work === undefined) {
    deps.context.flow.close(`No work is called ${id}.`);
    return;
  }
  renderWork(deps, work);
  deps.context.flow.close(`${work.progress.length} progress notes.`);
}

export async function runFinishWork(
  deps: WorkDeps,
  id: string,
  how: 'stop' | 'close',
): Promise<void> {
  deps.context.flow.open(`memnox work ${how}`);
  const answer = await ask(deps, {
    method: how === 'stop' ? DAEMON_METHOD.WORK_STOP : DAEMON_METHOD.WORK_CLOSE,
    workId: id,
  });
  if (failed(deps, answer)) return;
  deps.context.flow.close(how === 'stop' ? `${id} is stopped.` : `${id} is done.`);
}

export async function runAnswerHandoff(
  deps: WorkDeps,
  id: string,
  word: HandoffAnswerWord,
): Promise<void> {
  deps.context.flow.open(`memnox handoff ${word}`);
  const answer = await ask(deps, {
    method: DAEMON_METHOD.HANDOFF_ANSWER,
    handoffId: id,
    handoffAnswer: word,
  });
  if (failed(deps, answer)) return;
  deps.context.flow.close(
    word === HANDOFF_ANSWER_WORD.ACCEPT
      ? 'Handed on. The next agent reads each reference through its own access.'
      : 'Declined. The work stays where it was.',
  );
}

function renderWork(deps: WorkDeps, work: AgentWork): void {
  const latest = work.progress.at(-1);
  const waiting = work.handoffs.find((each) => each.state === 'requested');
  deps.context.flow.rows(work.target.externalId, [
    { label: 'id', value: work.id },
    { label: 'status', value: work.status },
    { label: 'agent profile', value: work.profileId },
    { label: 'responsible', value: work.responsiblePerson },
    work.target.url === undefined ? undefined : { label: 'link', value: work.target.url },
    latest === undefined ? undefined : { label: 'latest', value: latest.note },
    waiting === undefined
      ? undefined
      : { label: 'handoff waiting', value: `${waiting.id}: ${waiting.reason}` },
  ]);
}
