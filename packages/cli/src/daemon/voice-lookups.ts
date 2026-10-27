import {
  ConfirmKeys,
  isP256Point,
  SessionHosts,
  SPAN_KIND,
  SPAN_STATUS,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { recordSpan } from '../trace/voice-trace';
import type { SessionViews } from './session-view';

/**
 * The voice's plain lookups and records, each one request in and one answer out: the Mac's key,
 * a session as it is, where it runs, and the Mac's own timings for the question just answered.
 */

/** A turn's worth of the Mac's steps; more than this is not a turn. */
const MOST_MAC_SPANS = 12;

/** The Mac app's key, trusted on first use and never replaced from here. */
export async function registerKeyAnswer(
  home: string,
  request: DaemonRequest,
  now: string,
): Promise<DaemonResponse> {
  if (request.point === undefined || !isP256Point(request.point)) {
    return { id: request.id, ok: false, error: 'register-key needs a P-256 point' };
  }
  const outcome = await new ConfirmKeys(home).register(request.point, now);
  if ('registered' in outcome) return { id: request.id, ok: true, outcome: 'registered' };
  // Said, never replaced: the app compares and tells the person when it is not theirs.
  const same = outcome.alreadyRegistered.point === request.point;
  return { id: request.id, ok: same, outcome: same ? 'registered' : 'another key' };
}

/** A session as it is right now, for the live window on it. */
export async function sessionViewAnswer(
  views: SessionViews,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  if (request.sessionId === undefined) {
    return { id: request.id, ok: false, error: 'session-view needs a session' };
  }
  if (request.path !== undefined) {
    const diff = await views.diff(request.sessionId, request.path);
    return diff === null
      ? { id: request.id, ok: false, error: `no changes to ${request.path} are known` }
      : { id: request.id, ok: true, diff };
  }
  const session = await views.view(request.sessionId);
  return session === null
    ? { id: request.id, ok: false, error: `nothing is known about ${request.sessionId}` }
    : { id: request.id, ok: true, session };
}

/** Where the session's agent runs, and whether it still does. */
export async function locateAnswer(
  home: string,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  const sessionId = request.sessionId;
  if (sessionId === undefined) {
    return { id: request.id, ok: false, error: 'locate needs a session' };
  }
  const host = await new SessionHosts(home).read(sessionId);
  if (host === null) {
    return {
      id: request.id,
      ok: false,
      error: `nothing is known about where ${sessionId} runs`,
    };
  }
  const { pid, seenAt, ...where } = host;
  return { id: request.id, ok: true, location: { ...where, alive: isRunning(pid) } };
}

/** The Mac's own timings, hung on the question they belong to so one trace shows the whole answer. */
export async function macSpansAnswer(
  home: string,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  for (const span of (request.spans ?? []).slice(0, MOST_MAC_SPANS)) {
    await recordSpan(home, {
      name: `mac.${span.name}`,
      kind: SPAN_KIND.MAC,
      startAt: span.startAt,
      endAt: span.endAt,
      status: SPAN_STATUS.OK,
      attributes: span.attributes ?? {},
      under: 'root',
    });
  }
  return { id: request.id, ok: true, outcome: 'kept' };
}

/** Signal zero asks whether the process exists without touching it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Not ours to signal still means it is there.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
