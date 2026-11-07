import {
  AgentWorks,
  agentIdFor,
  branchRefOf,
  isFinished,
  joinedBy,
  profileIdFor,
  SessionTasks,
  sessionTaskOfWork,
  workRefsAt,
  type AgentWork,
  type SessionTask,
} from '@memnox/core';
import { readBindings } from '../agents/connections';

/**
 * A session joining the work a person pointed its profile at: named with `--work`, or found by the
 * branch it runs on. The work's issue becomes the session's task, so drift is still measured.
 */

interface JoinInput {
  home: string;
  sessionId: string;
  agent: string;
  root: string | null;
  /** The work id `--work` named, which must be this agent's profile's. */
  work?: string;
  now: string;
}

export async function joinWork(input: JoinInput): Promise<SessionTask | null> {
  const bindings = await readBindings(input.home);
  const profileId = profileIdFor(agentIdFor(input.agent), input.agent, bindings);
  const works = (await new AgentWorks(input.home).all()).filter(
    (each) => !isFinished(each),
  );
  const work =
    input.work === undefined
      ? await onBranch(works, profileId, input.root)
      : named(works, input.work, profileId);
  if (work === undefined) return null;
  await new AgentWorks(input.home).write(joinedBy(work, input.sessionId, input.now));
  const task = sessionTaskOfWork(work, input.sessionId, input.now);
  await new SessionTasks(input.home).declare(task);
  return task;
}

/** Refused rather than skipped, so a mistyped id is said at the start and never ignored. */
function named(works: readonly AgentWork[], id: string, profileId: string): AgentWork {
  const work = works.find((each) => each.id === id);
  if (work === undefined) throw new Error(`--work names no open work called ${id}.`);
  if (work.profileId !== profileId)
    throw new Error(
      `${id} is carried by the ${work.profileId} profile, not this agent's.`,
    );
  return work;
}

/** The one open piece of this profile's work whose issue the branch is named after. */
async function onBranch(
  works: readonly AgentWork[],
  profileId: string,
  root: string | null,
): Promise<AgentWork | undefined> {
  if (root === null) return undefined;
  const refs = await workRefsAt(root);
  const matching = works.filter((each) => {
    const ref = branchRefOf(each.target);
    return each.profileId === profileId && ref !== null && refs.includes(ref);
  });
  return matching.length === 1 ? matching[0] : undefined;
}
