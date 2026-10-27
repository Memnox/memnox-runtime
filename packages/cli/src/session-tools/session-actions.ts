import {
  BREAKER_SIGNAL,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  SessionPauses,
  UNNAMED_SESSION,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { OPERATOR_AGENT } from './propose-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { scopeOf } from './session-scope';

/**
 * Stopping and restarting a session by voice. Pausing only ever holds an agent back, so it is
 * done at once, like a refusal; resuming lets it carry on, so it is proposed and waits on Touch ID.
 */

/** Long enough to reach for the key, short enough that nobody confirms a stale one. */
const RESUME_TTL_MS = minutesToMs(5);

const NOT_AN_AGENT =
  'That is this Mac itself rather than an agent, so there is nothing to pause.';

export async function pauseSessionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const sessionId = await sessionOf(deps, args);
  if (sessionId === null)
    return { paused: false, said: 'No session was found to pause.' };
  if (sessionId === UNNAMED_SESSION) return { paused: false, said: NOT_AN_AGENT };
  const pauses = new SessionPauses(deps.home);
  if ((await pauses.inForce(sessionId)) !== null) {
    return { paused: true, session: sessionId, said: 'It was already paused.' };
  }
  const said = textArg(args, 'said');
  await pauses.pause({
    sessionId,
    signal: BREAKER_SIGNAL.ASKED,
    reason: said === undefined ? 'paused by voice' : `paused by voice: "${said}"`,
    reached: 0,
    ceiling: 0,
    pausedAt: deps.now().toISOString(),
  });
  return {
    paused: true,
    session: sessionId,
    said: 'Paused. Its next action waits until the person resumes it.',
  };
}

export async function proposeResumeTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const sessionId = await sessionOf(deps, args);
  if (sessionId === null) return { refused: 'No session was found to resume.' };
  if ((await new SessionPauses(deps.home).inForce(sessionId)) === null) {
    return { refused: `${sessionId} is not paused, so there is nothing to resume.` };
  }
  const said = textArg(args, 'said') ?? '';
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.RESUME, sessionId },
    rationale: said === '' ? `resume ${sessionId}` : said,
    ...(said === '' ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: RESUME_TTL_MS,
  });
  return {
    proposed: proposal.id,
    said: 'Waiting for Touch ID. It stays paused until the person confirms on the Mac.',
  };
}

async function sessionOf(deps: SessionToolDeps, args: ToolArgs): Promise<string | null> {
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  return scope.sessionId;
}
