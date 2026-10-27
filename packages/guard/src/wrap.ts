import type { CallContext, Decision, Guard } from './guard';

/**
 * Any function a framework calls a tool, governed: asked about before it runs, and its
 * outcome told to the circuit breaker after. For a framework with no hook of its own.
 */

export interface WrapOptions<Input> {
  /** The session the call belongs to, so a "for this session" answer and the breaker stay inside it. */
  session: (input: Input) => string;
  /** The arguments as the rules read them; the input itself when it is already an object. */
  argsOf?: (input: Input) => Readonly<Record<string, unknown>>;
  cwd?: string;
}

/** What a refused call throws, carrying the decision so a caller can say why in its own words. */
export class ToolRefused extends Error {
  constructor(readonly decision: Decision) {
    super(refusalText(decision));
    this.name = 'ToolRefused';
  }
}

export function wrapTool<Input, Output>(
  guard: Guard,
  name: string,
  run: (input: Input) => Promise<Output>,
  options: WrapOptions<Input>,
): (input: Input) => Promise<Output> {
  return async (input) => {
    const args = options.argsOf?.(input) ?? recordOf(input);
    const context: CallContext = {
      sessionId: options.session(input),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    };
    const decision = await guard.authorize(name, args, context);
    if (!decision.allowed) throw new ToolRefused(decision);
    try {
      const output = await run(input);
      // The answer is read for instructions, so a ticket that steers the agent taints the run.
      guard.outcome(name, args, context, { failed: false, output });
      return output;
    } catch (err) {
      guard.outcome(name, args, context, {
        failed: true,
        failureKind: err instanceof Error ? err.name : 'thrown',
      });
      throw err;
    }
  };
}

/** The sentence a model reads when a call was refused: the reason, and what to do instead. */
export function refusalText(decision: Decision): string {
  const instead =
    decision.alternative === undefined ? '' : ` Instead: ${decision.alternative}`;
  return `Memnox refused this: ${decision.reason}.${instead}`;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { input: value };
}
