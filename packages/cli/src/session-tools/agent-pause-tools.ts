import {
  AGENT_SUBJECT_PREFIX,
  agentFrozen,
  minutesToMs,
  OVERLAY_KIND,
  PROPOSAL_KIND,
  Proposals,
  SessionTurns,
  type AgentNameMatch,
  type SessionTurn,
} from '@memnox/core';
import { agentNamed, pauseAgent, type Paused } from '../agents/agent-pause';
import { WORKSPACE_TOLD } from '../sync/agent-pause-cloud';
import type { OperatorCall } from './operator-call';
import { proposeTool, SAID_ARG } from './operator-args';
import { OPERATOR_AGENT } from './propose-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';
import type { ScopeKind } from './session-scope';
import { stopSession } from './stop-tool';

/**
 * "Pause Codex": one agent stopped on this machine and every other left working. Pausing only holds
 * an agent back, so it happens at once; letting it carry on is proposed and waits on Touch ID.
 */

const AGENT_NAME_ARG = {
  type: 'string',
  description:
    'the agent as the person named it, such as "Codex", "Claude Code" or "Cursor", or the name they gave it',
} as const;

const PAUSE_AGENT_TOOL: ToolDefinition = {
  name: 'pause_agent',
  description:
    'Pause one agent on this machine, every session of it, when the person says to pause or hold an agent by name, or to keep it stopped, like "pause Codex", "hold Cursor" or "stop Claude Code until I say". It takes effect at once: the agent\'s next action is refused with word that a person paused it, any turn it has running is interrupted, and every other agent keeps working. The workspace is told too when this Mac is signed in. Pass the agent as they said it. When the answer is ambiguous, ask which of the agents it names they meant, in one short question. One session alone is pause_session, and stopping only what it is doing now, ready for the next instruction, is show with display stop.',
  inputSchema: {
    type: 'object',
    properties: { agent: AGENT_NAME_ARG, said: SAID_ARG },
  },
  // It holds an agent back and lets nothing happen, the same as a refusal.
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const PROPOSE_AGENT_RESUME_TOOL: ToolDefinition = proposeTool(
  'propose_agent_resume',
  'Let one agent the person paused carry on, like "let Cursor carry on" or "unpause Codex". Nothing restarts until they confirm with Touch ID on the Mac, so say that. When the answer is ambiguous, ask which agent they meant.',
  { agent: AGENT_NAME_ARG, said: SAID_ARG },
);

/** As long as any other proposal, so the Touch ID sheet never confirms something stale. */
const RESUME_TTL_MS = minutesToMs(5);

/** A turn opened longer ago than this is a session that crashed, not one still working. */
const WORKING_WITHIN_MS = minutesToMs(6 * 60);

const NAMED: ScopeKind = 'the session named';

async function pauseAgentTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<Record<string, unknown>> {
  const named = await namedAgent(deps, args);
  if (!('kind' in named)) return unresolved(named);
  const said = textArg(args, 'said');
  const paused = await pauseAgent(
    { home: deps.home, now: deps.now },
    named.kind,
    said ?? textArg(args, 'agent'),
  );
  const interrupted = await interruptWorking(deps, named.kind);
  return {
    paused: true,
    agent: named.kind,
    interrupted,
    workspace: paused.workspace.outcome,
    said: pausedSentence(paused, interrupted.length),
  };
}

async function proposeAgentResumeTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<Record<string, unknown>> {
  const named = await namedAgent(deps, args);
  if (!('kind' in named)) return unresolved(named);
  const said = textArg(args, 'said') ?? '';
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.COMMAND, argv: ['agents', 'resume', named.kind] },
    rationale: said === '' ? `Let ${named.kind} carry on` : said,
    ...(said === '' ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: RESUME_TTL_MS,
  });
  return {
    proposed: proposal.id,
    agent: named.kind,
    said: 'Waiting for Touch ID. It stays paused until the person confirms on the Mac.',
  };
}

async function namedAgent(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<AgentNameMatch> {
  const said = textArg(args, 'agent') ?? '';
  return agentNamed(deps.home, said);
}

function unresolved(named: AgentNameMatch): Record<string, unknown> {
  if ('ambiguous' in named) {
    return {
      paused: false,
      candidates: named.ambiguous,
      said: `That could be ${named.ambiguous.join(' or ')}. Ask which one they meant, and nothing was paused yet.`,
    };
  }
  const unknown = 'unknown' in named ? named.unknown : '';
  return {
    paused: false,
    said: `No agent here goes by "${unknown}". Ask which agent they meant.`,
  };
}

/** Escape in every session of this agent mid turn, and in no other agent's. */
async function interruptWorking(deps: SessionToolDeps, kind: string): Promise<string[]> {
  const now = deps.now().getTime();
  const turns = await new SessionTurns(deps.home).all();
  const working = turns.filter((turn) => isThisAgent(turn, kind) && midTurn(turn, now));
  const stopped = await Promise.all(
    working.map(async (turn) => {
      const scope = { sessionId: turn.sessionId, agent: turn.agent, scope: NAMED };
      try {
        const answer = await stopSession(deps, scope, turn.sessionId);
        return answer['stopped'] === true ? [turn.sessionId] : [];
      } catch {
        // The pause already holds it at its next step, so a window that would not take the key is not a failure.
        return [];
      }
    }),
  );
  return stopped.flat();
}

/** One agent by any of the names a session records it under, read the way the gate reads a freeze. */
export function isThisAgent(turn: Pick<SessionTurn, 'agent'>, kind: string): boolean {
  return agentFrozen(
    [`${OVERLAY_KIND.FREEZE}:${AGENT_SUBJECT_PREFIX}${kind}`],
    turn.agent,
  );
}

function midTurn(turn: SessionTurn, now: number): boolean {
  if (turn.promptAt === undefined) return false;
  if (turn.endedAt !== undefined && turn.endedAt >= turn.promptAt) return false;
  return now - Date.parse(turn.promptAt) <= WORKING_WITHIN_MS;
}

function pausedSentence(paused: Paused, interrupted: number): string {
  const first = paused.fresh
    ? `Paused ${paused.kind} on this Mac. Its next action is refused and every other agent keeps working.`
    : `${paused.kind} was already paused on this Mac.`;
  const stopped =
    interrupted === 0
      ? ''
      : ` What it was doing was interrupted in ${interrupted === 1 ? 'one session' : `${interrupted} sessions`}.`;
  return `${first}${stopped} ${WORKSPACE_SENTENCE[paused.workspace.outcome]} It lifts itself in a day if nobody resumes it.`;
}

const WORKSPACE_SENTENCE: Record<string, string> = {
  [WORKSPACE_TOLD.TOLD]: 'The workspace shows it paused too.',
  [WORKSPACE_TOLD.NO_WORKSPACE]:
    'Only this Mac knows, since it is not signed in to a workspace.',
  [WORKSPACE_TOLD.REFUSED]:
    'The workspace did not take it, so teammates will not see it, though it is paused here all the same.',
  [WORKSPACE_TOLD.UNREACHABLE]:
    'The workspace could not be reached, so teammates will not see it yet, though it is paused here all the same.',
};

export const AGENT_PAUSE_TOOLS: readonly ToolDefinition[] = [
  PAUSE_AGENT_TOOL,
  PROPOSE_AGENT_RESUME_TOOL,
];

export const AGENT_PAUSE_CALLS: Record<string, OperatorCall> = {
  pause_agent: (deps, _seams, args) => pauseAgentTool(deps, args),
  propose_agent_resume: (deps, _seams, args) => proposeAgentResumeTool(deps, args),
};
