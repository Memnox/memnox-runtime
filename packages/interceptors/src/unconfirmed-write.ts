import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  digest,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  newEventId,
  SqliteEventStore,
  TOOL_CLASS,
  type MemnoxEvent,
} from '@memnox/core';

/**
 * A write that went ahead while the workspace could not say whether another machine had
 * the same lines, kept as a row so the timeline shows it rather than a quiet success.
 */

export const UNCONFIRMED_OPERATION = 'lease.unconfirmed';

interface UnconfirmedWrite {
  sessionId: string;
  agent: string;
  /** The file as the lease named it. */
  path: string;
  /** What the agent was told, which is the row's reason. */
  said: string;
  at: string;
}

export function unconfirmedRow(input: UnconfirmedWrite): MemnoxEvent {
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: input.at,
    sessionId: input.sessionId,
    agent: input.agent,
    actorType: ACTOR_TYPE.AGENT,
    surface: EVENT_SURFACE.FILESYSTEM,
    operation: UNCONFIRMED_OPERATION,
    target: input.path,
    class: TOOL_CLASS.WRITE,
    // A lease is coordination and never a rule, so the write was allowed and the row says why it was unchecked.
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: input.said,
    argsDigest: digest(input.path),
  };
}

/** Best effort: a lost row must never stand in the way of the write it describes. */
export async function recordUnconfirmed(
  home: string,
  input: UnconfirmedWrite,
): Promise<void> {
  try {
    const ledger = SqliteEventStore.forHome(home);
    try {
      await ledger.append(unconfirmedRow(input));
    } finally {
      ledger.close();
    }
  } catch {
    // Nothing to do: the agent was still told, which is the half that matters.
  }
}
