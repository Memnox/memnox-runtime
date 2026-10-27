import { VoiceFocusStore } from '@memnox/core';
import type { SessionToolDeps } from './read-tools';

/** Why the focus is a session the voice just started, which has no id until its agent first acts. */
export const FOCUS_STARTED = 'started';

/** What was acted on: a running session by its scope, or where a new one was started. */
interface Acted {
  sessionId?: string | null;
  repository?: string;
  agent?: string;
}

/** Noted after the voice acts on a session, so the next "it" means that one; never fatal if it cannot be. */
export async function noteFocus(
  deps: SessionToolDeps,
  acted: Acted,
  why: string,
): Promise<void> {
  const { sessionId, repository, agent } = acted;
  await new VoiceFocusStore(deps.home)
    .set({
      ...(sessionId === null || sessionId === undefined ? {} : { sessionId }),
      ...(repository === undefined ? {} : { repository }),
      ...(agent === undefined ? {} : { agent }),
      why,
      at: deps.now().toISOString(),
    })
    .catch(() => undefined);
}
