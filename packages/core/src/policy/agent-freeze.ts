import { AGENT_ID_PREFIX } from '../discovery/agent';
import { OVERLAY_KIND } from './overlay';

/**
 * A person pausing one agent by name: how the freeze is spelled in state and what the agent is told.
 */

// Spelled as the cloud's AGENT_SUBJECT_PREFIX, so a freeze on agent `payments` never reads as one on service `payments`.
export const AGENT_SUBJECT_PREFIX = 'agent:';

// Read by the agent itself, so it says to wait rather than try the same work another way.
export const AGENT_FROZEN_REASON =
  'a person paused this agent, so stop and wait for them to resume it rather than trying another way; nothing it asks for runs until then';

/** True when a freeze on this agent by name is among the state labels in force. */
export function agentFrozen(
  state: readonly string[] | undefined,
  agentName: string,
): boolean {
  if (state === undefined || state.length === 0) return false;
  const prefix = `${OVERLAY_KIND.FREEZE}:${AGENT_SUBJECT_PREFIX}`;
  const wanted = sameProductAs(agentName);
  return state.some((fact) => {
    const label = fact.toLowerCase();
    return (
      label.startsWith(prefix) && sameProductAs(label.slice(prefix.length)) === wanted
    );
  });
}

/**
 * The console freezes by fleet id (`agt_codex-cli`), a hook runs as its kind (`codex-cli`) and a
 * shell seam as its launcher (`codex`), and all three are one agent.
 */
function sameProductAs(name: string): string {
  const lower = name.trim().toLowerCase();
  const bare = lower.startsWith(AGENT_ID_PREFIX)
    ? lower.slice(AGENT_ID_PREFIX.length)
    : lower;
  return bare.endsWith(CLI_SUFFIX) ? bare.slice(0, -CLI_SUFFIX.length) : bare;
}

const CLI_SUFFIX = '-cli';
