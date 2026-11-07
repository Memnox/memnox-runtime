import {
  AGENT_ID,
  AGENTS_METHOD,
  BREAKER_SIGNAL,
  DISCOVERED_AGENT_KIND,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  SessionPauses,
  startableKindOf,
  type DaemonRequest,
  type DaemonResponse,
  type SessionCard,
  type StartableAgent,
} from '@memnox/core';
import { agentNamed, pauseAgent } from '../agents/agent-pause';
import { launchAgent, launchable } from '../agents/agent-launch';
import { applyProfile } from '../profiles/profile-apply';
import { readAgentsView } from '../studio/agents-read';
import { readAgentsScan } from '../session-tools/agents-tool';
import type { SessionToolDeps } from '../session-tools/read-tools';

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
  /** What the session tools read with, for AGENTS_SCAN's sessions; absent where nothing scans. */
  sessionDeps?: () => SessionToolDeps;
  /** The scan's seams, faked in a test so it never reads the real home or starts a server. */
  scan?: Parameters<typeof readAgentsScan>[1];
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every answer carries the cards as they now stand, so a screen redraws from one answer. */
export async function agentsAnswer(
  home: string,
  request: DaemonRequest,
  deps: AgentsDeps,
): Promise<DaemonResponse> {
  // A read of its own, so it answers without the cards, which it has no use for.
  if (request.method === AGENTS_METHOD.AGENTS_SCAN) return scanAnswer(request, deps);
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

/** The agents the scan finds now, counted; no agent is an empty scan rather than a failure. */
async function scanAnswer(
  request: DaemonRequest,
  deps: AgentsDeps,
): Promise<DaemonResponse> {
  if (deps.sessionDeps === undefined) {
    return { id: request.id, ...refused('Scanning is not available here.') };
  }
  try {
    const found = await readAgentsScan(deps.sessionDeps(), deps.scan);
    return {
      id: request.id,
      ok: true,
      agentsScan: found ?? { agents: [], capabilities: { total: 0, areas: [] } },
    };
  } catch (err) {
    return {
      id: request.id,
      ...refused(err instanceof Error ? err.message : String(err)),
    };
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
  const input = {
    agent: request.agentKind,
    workingDirectory: request.workingDirectory,
    ...(deps.resolveCommand === undefined ? {} : { resolve: deps.resolveCommand }),
  };
  // Checked before any profile proposal is raised, so a refused launch leaves no card behind.
  const checked = await launchable(input);
  if ('refused' in checked) return refused(checked.refused);
  const profiled = await profileFirst(home, request, deps.now);
  if ('refused' in profiled) return refused(profiled.refused);
  const launched = await launchAgent(home, { ...input, now: deps.now });
  if ('refused' in launched) return refused(launched.refused);
  return { ok: true, agentLaunched: launched, ...profiled };
}

/** The hub's name for an agent a terminal opens, where the two differ. */
const HUB_KIND: Readonly<Record<string, string>> = {
  [AGENT_ID.CODEX]: DISCOVERED_AGENT_KIND.CODEX_CLI,
};

/** A profile named on a launch, applied to the agent in that folder before it opens. */
async function profileFirst(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Pick<Answered, 'profileApplied' | 'proposed'> | { refused: string }> {
  const { profileName, agentKind, workingDirectory } = request;
  if (profileName === undefined) return {};
  const startable = agentKind === undefined ? null : startableKindOf(agentKind);
  if (startable === null)
    return { refused: 'Name an agent Memnox can open in a terminal.' };
  const applied = await applyProfile(
    home,
    {
      profile: profileName,
      agent: HUB_KIND[startable] ?? startable,
      ...(workingDirectory === undefined ? {} : { project: workingDirectory }),
    },
    now,
  );
  if ('refused' in applied) return applied;
  // The first card to sign, so a screen opens it as the agent opens; the rest follow on the cards.
  const [first] = applied.proposed;
  return { profileApplied: applied, ...(first === undefined ? {} : { proposed: first }) };
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
