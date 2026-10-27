/**
 * Two agents about to send the same message, or work the same issue, through MCP servers
 * the proxy cannot sit in front of. Claimed as the proxy claims, so either path meets the other.
 */
import {
  actionResource,
  changesExternalState,
  CLAIM_ANSWER,
  meetingReason,
  TOOL_CLASS,
  withStatement,
  type IntendedAction,
  type LeaseHolder,
  type SharedActions,
} from '@memnox/core';

import type { ToolCall } from './tool-calls';

/** `mcp.<server>.<tool>`, the spelling that names the server, which a claim needs. */
const SERVER_ACTION = /^mcp\.([^.]+)\.(.+)$/;

/**
 * What this call would claim, named as the proxy names it so the fingerprints agree, or
 * null for a call two agents do not collide over: a read, or a call that names nothing.
 */
function mcpActionOf(call: ToolCall): IntendedAction | null {
  for (const request of call.requests) {
    const named = SERVER_ACTION.exec(request.action);
    if (named === null) continue;
    const server = named[1] ?? '';
    const tool = named[2] ?? '';
    // Without the statement the seam stamped, which the proxy's claim never carries.
    const args = withStatement(request.arguments ?? {}, null);
    const resource = actionResource(server, args);
    const worth =
      changesExternalState(request.class) ||
      (request.class === TOOL_CLASS.UNKNOWN && resource !== undefined);
    if (!worth) return null;
    return {
      operation: `${server}.${tool}`,
      arguments: args,
      ...(resource === undefined ? {} : { resource }),
    };
  }
  return null;
}

/**
 * The sentence the call is refused with where another agent has it, or null to let it go.
 * A hook cannot renew, so the claim holds for its window and lapses, which covers the call.
 */
export async function claimedElsewhere(
  call: ToolCall,
  actions: SharedActions,
  holder: LeaseHolder,
): Promise<string | null> {
  const action = mcpActionOf(call);
  if (action === null) return null;
  const outcome = await actions.claim(action, holder).catch(() => null);
  // Coordination, not safety: a workspace that cannot answer lets the call go.
  if (outcome === null) return null;
  if (outcome.answer === CLAIM_ANSWER.MINE || outcome.answer === CLAIM_ANSWER.UNKNOWN) {
    return null;
  }
  return meetingReason(outcome);
}
