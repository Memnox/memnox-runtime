import {
  AGENTS_METHOD,
  BREAKER_SIGNAL,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  SessionPauses,
  type DaemonRequest,
  type DaemonResponse,
  type SessionCard,
  type StartableAgent,
} from '@memnox/core';
import { agentNamed, pauseAgent } from '../agents/agent-pause';
import { launchAgent } from '../agents/agent-launch';
import { readAgentsView } from '../studio/agents-read';

/**
 * The agent manager's methods. Pausing an agent or stopping a session only holds work back, so
 * each is done at once; letting a paused agent carry on widens, so it waits on a signature.
 */

const AGENTS_METHODS: readonly string[] = Object.values(AGENTS_METHOD);

/** Who proposed it, as the card names it: the agent manager, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-agents';
const PROPOSAL_TTL_MS = minutesToMs(5);

export function isAgentsMethod(method: string): boolean {
  return AGENTS_METHODS.includes(method);
}

interface AgentsDeps {
  now: Date;
  cards: () => Promise<SessionCard[]>;
  /** Where an agent's command is found; the login shell by default, a fixed answer in a test. */
  resolveCommand?: (agent: StartableAgent) => string | null;
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every answer carries the cards as they now stand, so a screen redraws from one answer. */
export async function agentsAnswer(
  home: string,
  request: DaemonRequest,
  deps: AgentsDeps,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, deps).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return { id: request.id, ...answered, agentsView: await readAgentsView(home, deps) };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: AgentsDeps,
): Promise<Answered> {
  const now = deps.now;
  switch (request.method) {
    case AGENTS_METHOD.AGENT_PAUSE:
      return pause(home, request.agentKind, now);
    case AGENTS_METHOD.AGENT_RESUME:
      return resume(home, request.agentKind, now);
    case AGENTS_METHOD.SESSION_STOP:
      return stopSession(home, request.sessionId, now);
    case AGENTS_METHOD.AGENT_LAUNCH:
      return launch(home, request, deps);
    default:
      return { ok: true };
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

/** The kind a typed or chosen name means, or why it means none. */
async function kindOf(
  home: string,
  typed: string | undefined,
): Promise<{ kind: string } | { refused: string }> {
  if (typed === undefined || typed.trim() === '') return { refused: 'Name the agent.' };
  const match = await agentNamed(home, typed);
  if ('kind' in match) return { kind: match.kind };
  return {
    refused:
      'ambiguous' in match
        ? `"${typed}" could be ${match.ambiguous.join(' or ')}. Name one of them.`
        : `No agent goes by "${typed}".`,
  };
}

async function pause(
  home: string,
  typed: string | undefined,
  now: Date,
): Promise<Answered> {
  const named = await kindOf(home, typed);
  if ('refused' in named) return refused(named.refused);
  await pauseAgent({ home, now: () => now }, named.kind, 'paused from the agent manager');
  return { ok: true };
}

async function resume(
  home: string,
  typed: string | undefined,
  now: Date,
): Promise<Answered> {
  const named = await kindOf(home, typed);
  if ('refused' in named) return refused(named.refused);
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.AGENT_RESUME, agent: named.kind },
    rationale: `Let ${named.kind} carry on`,
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { ok: true, proposed: proposal.id };
}

/** Opening a terminal the person asked for from a screen; the agent then runs under Memnox as any run does. */
async function launch(
  home: string,
  request: DaemonRequest,
  deps: AgentsDeps,
): Promise<Answered> {
  const launched = await launchAgent(home, {
    agent: request.agentKind,
    workingDirectory: request.workingDirectory,
    now: deps.now,
    ...(deps.resolveCommand === undefined ? {} : { resolve: deps.resolveCommand }),
  });
  if ('refused' in launched) return refused(launched.refused);
  return { ok: true, agentLaunched: launched };
}

/** The same hold a voice pause puts on a session: its next action waits until a person resumes it. */
async function stopSession(
  home: string,
  sessionId: string | undefined,
  now: Date,
): Promise<Answered> {
  if (sessionId === undefined || sessionId === '')
    return refused('Name the session to stop.');
  await new SessionPauses(home).pause({
    sessionId,
    signal: BREAKER_SIGNAL.ASKED,
    reason: 'stopped from the agent manager',
    reached: 0,
    ceiling: 0,
    pausedAt: now.toISOString(),
  });
  return { ok: true };
}
