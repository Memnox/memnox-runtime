import {
  breakerPauseFor,
  outcomesFrom,
  describeStrain,
  isStrained,
  POST_KIND,
  SessionPosts,
  strainOf,
  type SessionStrain,
  describePause,
  REPLAY_LIMIT,
  SessionPauses,
  SqliteEventStore,
  type BreakerThresholds,
  type MemnoxEvent,
  type SessionPause,
} from '@memnox/core';

/**
 * The circuit breaker in the seam, replaying the session from the ledger every seam
 * already writes to, so no daemon is needed. A ledger that will not open loses the
 * breaker and never the command.
 */
export interface BreakerSeamOptions {
  home: string;
  sessionId: string | undefined;
  thresholds?: BreakerThresholds;
}

/** The pause holding this session, or null. Read before anything is allowed to run. */
export async function pauseHolding(
  home: string,
  sessionId: string | undefined,
): Promise<SessionPause | null> {
  if (sessionId === undefined || sessionId === '') return null;
  try {
    return await new SessionPauses(home).inForce(sessionId);
  } catch {
    // Unreadable is not paused: a broken pause file must not wedge every command.
    return null;
  }
}

/** What a held session prints instead of running. Named so `resume` is discoverable. */
export function pauseMessage(pause: SessionPause): string {
  return [
    `Paused by Memnox: ${describePause(pause)}`,
    `Resume with "memnox resume ${pause.sessionId}".`,
  ].join('\n');
}

/**
 * When a person last let this session carry on, or null when it has never been paused.
 */
async function resumedAt(home: string, sessionId: string): Promise<string | null> {
  try {
    const pause = await new SessionPauses(home).read(sessionId);
    return pause?.resumedAt ?? null;
  } catch {
    return null;
  }
}

/**
 * Only what happened since the last resume, or the
 * failures that caused the pause trip it again.
 */
export async function readSinceResume(
  home: string,
  sessionId: string,
): Promise<MemnoxEvent[]> {
  const since = await resumedAt(home, sessionId);
  const store = SqliteEventStore.forHome(home);
  try {
    return await store.query({
      sessionId,
      limit: REPLAY_LIMIT,
      ...(since === null ? {} : { since }),
    });
  } finally {
    store.close();
  }
}

/**
 * Replay this session after the action, since eleven
 * identical failures are knowable only after the eleventh.
 */
export async function observeSession(
  options: BreakerSeamOptions,
): Promise<SessionPause | null> {
  const { home, sessionId } = options;
  if (sessionId === undefined || sessionId === '') return null;

  try {
    const pause = breakerPauseFor({
      sessionId,
      events: await readSinceResume(home, sessionId),
      pausedAt: new Date().toISOString(),
      ...(options.thresholds === undefined ? {} : { thresholds: options.thresholds }),
    });
    if (pause === null) return null;
    await new SessionPauses(home).pause(pause);
    return pause;
  } catch {
    // No ledger, or it would not open. The command has already run either way.
    return null;
  }
}

/**
 * What this session has failed at and not got past, since the last resume, for the gate to
 * narrow on. A ledger that will not open is no strain, never a refusal.
 */
export async function strainHolding(
  home: string,
  sessionId: string | undefined,
  agent = 'an agent',
): Promise<SessionStrain | null> {
  if (sessionId === undefined || sessionId === '') return null;
  try {
    const strain = strainOf(outcomesFrom(await readSinceResume(home, sessionId)));
    await postStrain(home, { sessionId, agent }, strain);
    return strain;
  } catch {
    return null;
  }
}

/**
 * Said once when a session starts struggling and taken back once it got past it, so a person
 * away hears it at the moment its reach narrowed and not on every command after.
 */
async function postStrain(
  home: string,
  who: { sessionId: string; agent: string },
  strain: SessionStrain,
): Promise<void> {
  const posts = new SessionPosts(home);
  const posted = await posts.read(POST_KIND.STRUGGLING, who.sessionId);
  if (!isStrained(strain)) {
    if (posted !== null) await posts.remove(POST_KIND.STRUGGLING, who.sessionId);
    return;
  }
  if (posted !== null) return;
  await posts.put({
    kind: POST_KIND.STRUGGLING,
    sessionId: who.sessionId,
    agent: who.agent,
    summary: `${who.agent} is struggling: ${describeStrain(strain)}.`,
    at: new Date().toISOString(),
  });
}
