import { readJsonArray, writeJsonFile } from '@memnox/core';
import { brainSessionsPath } from '../memnox-paths';

/**
 * The sessions the voice's brain opened in an agent such as Hermes, which keeps them in its own
 * list beside the person's. Read back so the Mac never shows the voice thinking as an agent working.
 */

/** Weeks of checks and conversations, far more than the three days a list looks back over. */
const MOST_KEPT = 500;

/** Noted once per session, newest last, the oldest dropped past the bound. */
export async function rememberBrainSession(
  home: string,
  sessionId: string,
): Promise<void> {
  const kept = await readBrainSessions(home);
  if (kept.has(sessionId)) return;
  await writeJsonFile(brainSessionsPath(home), [...kept, sessionId].slice(-MOST_KEPT));
}

export async function readBrainSessions(home: string): Promise<Set<string>> {
  const kept = await readJsonArray<unknown>(brainSessionsPath(home));
  return new Set(kept.filter((each): each is string => typeof each === 'string'));
}
