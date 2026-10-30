import type { EventSink, MemnoxEvent } from '../event/event';
import { SessionTasks, type SessionTask } from '../session/session-task';
import { LEDGER_SESSION_LIMIT } from './ledger.constants';

/**
 * What led up to a decision, read from what was recorded and never from a model: the task
 * somebody declared for the session, and the steps the session took just before it.
 */

/** Enough steps to see where the agent was heading, few enough to read at a glance. */
const STEPS_BEFORE = 3;

export interface LeadUp {
  task: SessionTask | null;
  before: MemnoxEvent[];
}

export async function leadUpTo(
  store: Pick<EventSink, 'query'>,
  event: MemnoxEvent,
  home: string,
): Promise<LeadUp> {
  // A task file that will not read is a session nobody declared a task for.
  const task = await new SessionTasks(home).read(event.sessionId).catch(() => null);
  const session = await store.query({
    sessionId: event.sessionId,
    until: event.at,
    limit: LEDGER_SESSION_LIMIT,
  });
  // Oldest first from the store, so the last few are the ones just before.
  const before = session
    .filter((each) => each.id !== event.id && each.at <= event.at)
    .slice(-STEPS_BEFORE);
  return { task, before };
}
