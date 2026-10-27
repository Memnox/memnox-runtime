/**
 * The Claude Agent SDK, governed through its hooks rather than its permission callback,
 * because a hook runs whatever permission mode the agent was started in. Typed by shape,
 * so this package depends on no model SDK.
 */
import type { Guard } from './guard';

/** The fields of a PreToolUse or PostToolUse hook input this reads. */
export interface ToolHookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input?: unknown;
  tool_response?: unknown;
  session_id?: string;
  cwd?: string;
}

/** The hook output that refuses a call, with the reason the agent is told. */
export interface PreToolUseOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

type ToolHook = (
  input: ToolHookInput,
  toolUseId?: string,
  options?: unknown,
) => Promise<object>;

interface HookMatcher {
  matcher?: string;
  hooks: ToolHook[];
}

interface QueryParams {
  prompt: unknown;
  options?: {
    hooks?: Record<string, HookMatcher[] | undefined>;
    [option: string]: unknown;
  };
}

const NO_SESSION = 'claude-agent-sdk';

/**
 * Asks the guard before each tool runs. An allow leaves the decision to the SDK's own
 * settings, so Memnox never permits more than the agent was configured to do.
 */
export function preToolUseHook(guard: Guard): ToolHook {
  return async (input) => {
    const decision = await guard.authorize(input.tool_name, recordOf(input.tool_input), {
      sessionId: input.session_id ?? NO_SESSION,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    });
    if (decision.allowed) return {};
    const instead =
      decision.alternative === undefined ? '' : ` Instead: ${decision.alternative}`;
    const output: PreToolUseOutput = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Memnox: ${decision.reason}.${instead}`,
      },
    };
    return output;
  };
}

/**
 * Tells the circuit breaker how each call ended, so a loop of the same failure is paused,
 * and hands over what the tool answered, so text written to steer the agent taints the run.
 */
export function postToolUseHook(guard: Guard): ToolHook {
  return async (input) => {
    guard.outcome(
      input.tool_name,
      recordOf(input.tool_input),
      {
        sessionId: input.session_id ?? NO_SESSION,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      },
      { ...failureOf(input.tool_response), output: input.tool_response },
    );
    return {};
  };
}

/** `query` with Memnox's hooks added beside whatever hooks the caller already set. */
export function wrapClaudeAgentQuery<Params extends QueryParams, Result>(
  query: (params: Params) => Result,
  guard: Guard,
): (params: Params) => Result {
  const before = { hooks: [preToolUseHook(guard)] };
  const after = { hooks: [postToolUseHook(guard)] };
  return (params) => {
    const hooks = params.options?.hooks ?? {};
    return query({
      ...params,
      options: {
        ...params.options,
        hooks: {
          ...hooks,
          PreToolUse: [...(hooks['PreToolUse'] ?? []), before],
          PostToolUse: [...(hooks['PostToolUse'] ?? []), after],
        },
      },
    });
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A failure where the tool said so plainly, keyed on its first line so the same error repeats as the same kind. */
function failureOf(response: unknown): { failed: boolean; failureKind?: string } {
  const fields = recordOf(response);
  const code = fields['exitCode'] ?? fields['exit_code'];
  const failed =
    fields['is_error'] === true ||
    fields['isError'] === true ||
    (typeof code === 'number' && code !== 0);
  if (!failed) return { failed: false };
  const said = [fields['stderr'], fields['error'], fields['content']].find(
    (each): each is string => typeof each === 'string' && each !== '',
  );
  return said === undefined
    ? { failed: true }
    : { failed: true, failureKind: said.split('\n')[0]?.slice(0, 200) ?? '' };
}
