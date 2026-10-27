import { basename } from 'node:path';
import {
  LEDGER_SESSION_LIMIT,
  milestonesOfSession,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  SessionHosts,
  UNNAMED_SESSION,
  type Milestone,
  type Milestones,
  type Proposal,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { repositoriesOf } from './changes-tool';
import { mainCheckoutOf } from './main-checkout';
import { OPERATOR_AGENT } from './propose-tools';
import { noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { RewindSeams } from './rewind-tool';
import { scopeOf } from './session-scope';

/**
 * "That broke it, put it back": the working tree back to before what a session just did. It
 * moves files, so it is proposed and waits on Touch ID, and the tree as it is now is kept first,
 * so "bring it back" is a second rewind to that.
 */

/** Long enough to reach for the key, short enough that nobody confirms a stale one. */
const REWIND_TTL_MS = minutesToMs(5);

const READ_BACK =
  'Nothing has moved yet. Read back in a sentence what goes back: the repository by name, roughly when it goes back to, and how many files, like "I\'ll put memnox runtime back to twenty minutes ago, three files. Touch ID on the Mac to confirm." Their current files are kept first, so they can ask to bring them back.';

export async function proposeRewindTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  args: ToolArgs,
): Promise<unknown> {
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null || scope.sessionId === UNNAMED_SESSION) {
    return { proposed: false, said: 'No agent session was found to put back.' };
  }
  const repository = await repositoryOf(deps, scope.sessionId);
  if (repository === null) return { proposed: false, said: NO_REPOSITORY };
  const milestones = seams.build(repository);
  const undo = textArg(args, 'undo') === 'true';
  const target = undo
    ? await milestones.latest().catch(() => null)
    : await beforeLatestWork(milestones, scope.sessionId);
  if (target === null)
    return { proposed: false, said: undo ? NOTHING_TO_UNDO : NO_MILESTONE };
  const files = (await milestones.changedSince(target.id).catch(() => [])).length;
  const proposal = await writeProposal(deps, {
    repository,
    target,
    files,
    undo,
    sessionId: scope.sessionId,
    said: textArg(args, 'said'),
  });
  await noteFocus(deps, scope, 'put back');
  const backTo = target.takenAt;
  return {
    proposed: proposal.id,
    repository: basename(repository),
    backTo,
    files,
    said: READ_BACK,
  };
}

interface RewindPlan {
  repository: string;
  target: Milestone;
  files: number;
  undo: boolean;
  sessionId: string;
  said: string | undefined;
}

/** The proposal the Touch ID sheet shows, worded as what goes back and how much. */
function writeProposal(deps: SessionToolDeps, plan: RewindPlan): Promise<Proposal> {
  const { repository, target, files, undo, sessionId, said } = plan;
  return new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.REWIND, repository, milestone: target.id, sessionId },
    rationale: `${undo ? 'Bring back' : 'Put back'} ${basename(repository)} as it was at ${clockTime(target.takenAt)}, ${files} files`,
    ...(said === undefined ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: REWIND_TTL_MS,
  });
}

const NO_REPOSITORY =
  'That session wrote in no repository, so there is nothing to put back.';
const NOTHING_TO_UNDO = 'There is no rewind here to bring back.';
const NO_MILESTONE =
  'No milestone was taken for that session with anything changed since, so there is nothing to put back to.';

/** The newest milestone of the session that anything changed since, which is "before what it just did". */
async function beforeLatestWork(
  milestones: Milestones,
  sessionId: string,
): Promise<Milestone | null> {
  const own = milestonesOfSession(
    await milestones.list().catch(() => []),
    sessionId,
  ).reverse();
  for (const milestone of own) {
    if ((await milestones.changedSince(milestone.id).catch(() => [])).length > 0)
      return milestone;
  }
  return null;
}

/** Where it wrote last, else where it was opened. */
async function repositoryOf(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<string | null> {
  const rows = await withEvents(deps.home, (store) =>
    store.query({ sessionId, limit: LEDGER_SESSION_LIMIT }),
  );
  const wrote = repositoriesOf(rows)[0];
  if (wrote !== undefined) return wrote;
  const cwd = (await new SessionHosts(deps.home).read(sessionId))?.cwd;
  return cwd === undefined ? null : mainCheckoutOf(cwd);
}

/** The time on the Touch ID sheet the way a clock shows it, never an ISO string. */
function clockTime(moment: string): string {
  return new Date(moment).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
