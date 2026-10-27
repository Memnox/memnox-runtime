import { SessionSubagents } from '@memnox/core';
import type { EditHookContext } from './edit-claims';
import { fieldsOf, firstText } from './hook-payload';
import type { HookFields } from './hook-payload';
import { log } from './seam-runtime';

/**
 * Notes a session's helpers from the hook payload after each tool call: the parent launching
 * one through its Agent tool, and a helper's own calls, which carry its agent id.
 */

/** The tool a Claude Code session hands work to a helper with, under its old name and its new. */
const LAUNCH_TOOLS: readonly string[] = ['Agent', 'Task'];

export async function noteSubagent(
  payload: unknown,
  context: EditHookContext,
  sessionId: string,
): Promise<void> {
  const hook = fieldsOf(payload);
  if (hook === null) return;
  const subagents = new SessionSubagents(context.home);
  const at = context.now().toISOString();
  try {
    await noteActivity(hook, subagents, sessionId, at);
    await noteLaunch(hook, subagents, sessionId, at);
  } catch (err) {
    // Knowing about helpers is a convenience: a session is never held up for it.
    log(`could not note a helper: ${String(err)}`);
  }
}

/** A helper's own tool call, which carries its agent id. */
async function noteActivity(
  hook: HookFields,
  subagents: SessionSubagents,
  sessionId: string,
  at: string,
): Promise<void> {
  const agentId = firstText(hook, ['agent_id']);
  if (agentId === undefined) return;
  const type = firstText(hook, ['agent_type']);
  const tool = firstText(hook, ['tool_name']);
  const cwd = firstText(hook, ['cwd']);
  await subagents.acted({
    sessionId,
    agentId,
    ...(type === undefined ? {} : { type }),
    ...(tool === undefined ? {} : { tool }),
    ...(cwd === undefined ? {} : { cwd }),
    at,
  });
}

/** The parent handing work over, in the words it handed it over with. */
async function noteLaunch(
  hook: HookFields,
  subagents: SessionSubagents,
  sessionId: string,
  at: string,
): Promise<void> {
  const tool = firstText(hook, ['tool_name']);
  if (tool === undefined || !LAUNCH_TOOLS.includes(tool)) return;
  const input = fieldsOf(hook['tool_input']);
  const description =
    input === null ? undefined : firstText(input, ['description', 'prompt']);
  if (input === null || description === undefined) return;
  const type = firstText(input, ['subagent_type']);
  await subagents.launched({
    sessionId,
    description,
    ...(type === undefined ? {} : { type }),
    background: input['run_in_background'] === true,
    at,
  });
}
