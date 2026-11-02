/**
 * What an agent read through one of its MCP servers, kept in the person's own memory on this
 * machine so it is learned from like their notes. The ledger row stays names only; only the
 * local memory holds the content, redacted, capped and marked untrusted.
 */
import { keepToolCall, mcpToolParts, TOOL_CALL_VIA } from '@memnox/core';

import { fieldsOf } from './hook-payload';
import { afterToolOf, isOwnTool } from './result-taint';

/** Who made the call, as the hook already knows them. */
interface CallMemoryContext {
  home: string;
  agent: string;
  sessionId: string;
  now: () => Date;
}

/** Best effort and after the tool ran, so a call that could not be kept never stops the agent. True when kept. */
export async function keepMcpResult(
  payload: unknown,
  context: CallMemoryContext,
): Promise<boolean> {
  const hook = fieldsOf(payload);
  if (hook === null) return false;
  const after = afterToolOf(hook);
  // Memnox's own tools keep what they read themselves, and say only what the session holds.
  if (after === null || isOwnTool(after.tool)) return false;
  const parts = mcpToolParts(after.tool);
  if (parts === null) return false;
  const kept = await keepToolCall(context.home, {
    via: TOOL_CALL_VIA.MCP,
    agent: context.agent,
    ...(context.sessionId === '' ? {} : { sessionId: context.sessionId }),
    server: parts.server,
    tool: parts.name,
    at: context.now().toISOString(),
    result: after.result,
  });
  return 'kept' in kept;
}
