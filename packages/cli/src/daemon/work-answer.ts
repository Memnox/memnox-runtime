import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  AgentWorks,
  externalTaskOf,
  finishedWork,
  HANDOFF_ANSWER_WORD,
  startedWork,
  WORK_METHOD,
  WORK_STATUS,
  withHandoffAnswer,
  type DaemonRequest,
  type DaemonResponse,
  type SessionCard,
  type WorkOutcome,
} from '@memnox/core';
import { readProfilesWithConnections } from '../profiles/profile-connections';
import { responsiblePersonHere } from '../profiles/responsible-person';

/**
 * The agent work methods, every one a person's from their own screen: start, stop, close and
 * answer a handoff. An agent reports through its session tools instead, and can call none of these.
 */

const WORK_METHODS: readonly string[] = Object.values(WORK_METHOD);

export function isWorkMethod(method: string): boolean {
  return WORK_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

interface WorkDeps {
  now: Date;
  cards?: () => Promise<SessionCard[]>;
}

/** Every answer carries the work as it now stands, so a screen redraws from one answer. */
export async function workAnswer(
  home: string,
  request: DaemonRequest,
  deps: WorkDeps,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, deps).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return { id: request.id, ...answered, agentWork: await new AgentWorks(home).all() };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: WorkDeps,
): Promise<Answered> {
  const at = deps.now.toISOString();
  switch (request.method) {
    case WORK_METHOD.WORK_START:
      return start(home, request, deps);
    case WORK_METHOD.WORK_STOP:
      return change(home, request.workId, (work) =>
        finishedWork(work, { status: WORK_STATUS.STOPPED, at }),
      );
    case WORK_METHOD.WORK_CLOSE:
      return change(home, request.workId, (work) =>
        finishedWork(work, { status: WORK_STATUS.DONE, at }),
      );
    case WORK_METHOD.HANDOFF_ANSWER:
      return answerHandoff(home, request, at);
    default:
      return { ok: true };
  }
}

async function start(
  home: string,
  request: DaemonRequest,
  deps: WorkDeps,
): Promise<Answered> {
  const { workProfile, workTarget, workProject } = request;
  if (workProfile === undefined || workTarget === undefined)
    return refused('Name the profile and the issue it is to carry.');
  const target = externalTaskOf(workTarget, request.workTracker);
  if (target === null)
    return refused('Name the issue as a key such as LIN-123, or paste its link.');
  const profiles = await readProfilesWithConnections(home, {
    now: deps.now,
    cards: deps.cards ?? (async (): Promise<SessionCard[]> => []),
  });
  const wanted = workProfile.trim().toLowerCase();
  const profile = profiles.find(
    (each) => each.id === wanted || each.name.toLowerCase() === wanted,
  );
  if (profile === undefined) return refused(`No profile is called ${workProfile}.`);
  if (workProject !== undefined && !(await isFolder(workProject)))
    return refused('Name the project as a folder on this computer.');
  const person = await responsiblePersonHere(home);
  const title = request.workTitle === undefined ? undefined : request.workTitle.trim();
  const work = startedWork(
    {
      profileId: profile.id,
      responsiblePerson: profile.responsiblePerson ?? person,
      ...(profile.responsiblePerson === person ? {} : { assignedBy: person }),
      target: title === undefined || title === '' ? target : { ...target, title },
      ...(workProject === undefined ? {} : { projectRoot: workProject }),
    },
    deps.now.toISOString(),
  );
  await new AgentWorks(home).write(work);
  return { ok: true };
}

async function change(
  home: string,
  workId: string | undefined,
  how: (work: Parameters<typeof finishedWork>[0]) => WorkOutcome,
): Promise<Answered> {
  if (workId === undefined) return refused('Name the work.');
  const store = new AgentWorks(home);
  const work = await store.read(workId);
  if (work === undefined) return refused(`No work is called ${workId}.`);
  const outcome = how(work);
  if ('refused' in outcome) return refused(outcome.refused);
  await store.write(outcome.work);
  return { ok: true };
}

async function answerHandoff(
  home: string,
  request: DaemonRequest,
  at: string,
): Promise<Answered> {
  const { handoffId, handoffAnswer } = request;
  if (handoffId === undefined || handoffAnswer === undefined)
    return refused('Name the handoff and say accept or decline.');
  const store = new AgentWorks(home);
  const work = await store.withHandoff(handoffId);
  if (work === undefined) return refused('No handoff waits under that id.');
  const outcome = withHandoffAnswer(work, {
    handoffId,
    accepted: handoffAnswer === HANDOFF_ANSWER_WORD.ACCEPT,
    by: await responsiblePersonHere(home),
    at,
  });
  if ('refused' in outcome) return refused(outcome.refused);
  await store.write(outcome.work);
  return { ok: true };
}

async function isFolder(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Absent is the person's to fix, and is said as such rather than thrown.
    return false;
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}
