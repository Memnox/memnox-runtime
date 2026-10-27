/**
 * Which session a tool call is about: the run that launched the agent where `memnox run`
 * named one, else that agent's latest, so one agent never reads another's by default.
 */
import {
  LEDGER_LATEST_ONLY,
  SESSION_VAR,
  SessionTurns,
  type SqliteEventStore,
} from '@memnox/core';

const SCOPE = {
  /** `memnox run` named the session in the agent's environment. */
  THIS_RUN: 'this run',
  /** The newest session this agent has on the record. */
  AGENT_LATEST: 'this agent, latest session',
  /** Asked for by id. */
  NAMED: 'the session named',
  NONE: 'no session on the record',
} as const;

export type ScopeKind = (typeof SCOPE)[keyof typeof SCOPE];

export interface SessionScope {
  sessionId: string | null;
  agent: string;
  scope: ScopeKind;
}

/** Who is asking and where Memnox keeps its records, as the session tools already carry them. */
interface ScopeDeps {
  agent: string;
  env: NodeJS.ProcessEnv;
  home?: string;
}

/** The session a call reads, and how it was found, said in the answer so nothing is guessed. */
export async function scopeOf(
  store: SqliteEventStore,
  { agent, env, home }: ScopeDeps,
  asked?: string,
): Promise<SessionScope> {
  if (asked !== undefined && asked !== '') {
    return { sessionId: asked, agent, scope: SCOPE.NAMED };
  }
  const running = env[SESSION_VAR];
  if (running !== undefined && running !== '') {
    return { sessionId: running, agent, scope: SCOPE.THIS_RUN };
  }
  const latest = await store.query({ agent, limit: LEDGER_LATEST_ONLY });
  const row = latest[latest.length - 1];
  const fresher =
    home === undefined ? null : await justStarted(home, agent, row?.at ?? '');
  const sessionId = fresher ?? row?.sessionId;
  return sessionId === undefined
    ? { sessionId: null, agent, scope: SCOPE.NONE }
    : { sessionId, agent, scope: SCOPE.AGENT_LATEST };
}

/**
 * A session newer than anything in the ledger: asked something and still thinking, or answered
 * without running anything. A window merely opened is not counted, since it has done nothing
 * and would take the place of the session that just finished the work they are asking about.
 */
async function justStarted(
  home: string,
  agent: string,
  since: string,
): Promise<string | null> {
  const moments = (await new SessionTurns(home).all())
    .filter((each) => each.agent === agent)
    .flatMap((each) =>
      [each.promptAt, each.endedAt]
        .filter((at): at is string => at !== undefined)
        .map((at) => ({ id: each.sessionId, at })),
    )
    .filter((each) => each.at > since);
  return moments.sort((a, b) => b.at.localeCompare(a.at))[0]?.id ?? null;
}
