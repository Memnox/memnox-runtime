/**
 * The OpenAI Agents SDK, governed at each function tool's `invoke`, which is what the
 * runner calls whatever approval settings the tool carries. A refusal is returned as the
 * tool's output, so the model reads why and what to do instead. Typed by shape, so this
 * package depends on no model SDK.
 */
import type { Guard } from './guard';
import { refusalText } from './wrap';

/** The fields of an OpenAI Agents function tool this reads and wraps. */
export interface AgentsFunctionTool<RunContext> {
  type: 'function';
  name: string;
  invoke: (runContext: RunContext, input: string, details?: unknown) => Promise<unknown>;
}

export interface OpenAIAgentsOptions<RunContext> {
  /** The session a run belongs to, read from the run's own context. */
  session: (runContext: RunContext) => string;
  cwd?: string;
}

/** The same tools, each asking the guard before it runs and telling the breaker how it went. */
export function guardAgentsTools<RunContext, Tool extends AgentsFunctionTool<RunContext>>(
  tools: readonly Tool[],
  guard: Guard,
  options: OpenAIAgentsOptions<RunContext>,
): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    invoke: async (runContext: RunContext, input: string, details?: unknown) => {
      const args = argsOf(input);
      const context = {
        sessionId: options.session(runContext),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      const decision = await guard.authorize(tool.name, args, context);
      if (!decision.allowed) return refusalText(decision);
      try {
        const output = await tool.invoke(runContext, input, details);
        guard.outcome(tool.name, args, context, { failed: false, output });
        return output;
      } catch (err) {
        guard.outcome(tool.name, args, context, {
          failed: true,
          failureKind: err instanceof Error ? err.name : 'thrown',
        });
        throw err;
      }
    },
  }));
}

/** The model's arguments arrive as JSON text; anything unreadable is ruled on as one opaque value. */
function argsOf(input: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { input: parsed };
  } catch {
    // Not JSON, so the rules see it whole rather than not at all.
    return { input };
  }
}
