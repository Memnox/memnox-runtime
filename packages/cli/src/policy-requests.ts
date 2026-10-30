import {
  alternativeFor,
  classifyToolCall,
  EFFECT_PRECEDENCE,
  HTTP_METHOD_ARGUMENT,
  ownToolDeclaration,
  resolveShellLine,
  targetsRuledOn,
  verbForAction,
  verbTableFor,
  type ActionRequest,
  type Alternative,
  type LocalGate,
  type LocalVerdict,
} from '@memnox/core';

/**
 * One action ruled on as a seam would rule on it, recording and changing nothing: shared by
 * `memnox policy test` and the Policy Studio's dry run, so the two never answer differently.
 */

interface DryRunOptions {
  target?: string;
  /** What the action does, for an action named outright whose class nothing here knows. */
  class?: string;
  workingDirectory?: string;
  /** The project of that folder, as a seam would find it, so a project's rules answer too. */
  projectId?: string;
}

interface DryRun {
  verdict: LocalVerdict;
  /** A refusal that names no way forward is a dead end the agent cannot act on. */
  alternative: Alternative | undefined;
  /** The action the verb table filed its way forward under. */
  refused: string | undefined;
}

/** The strictest verdict of every target the action names, since any one of them decides. */
export function dryRun(
  gate: LocalGate,
  action: string,
  options: DryRunOptions,
  env: NodeJS.ProcessEnv,
): DryRun {
  const verdict = requestsFor(action, options, env)
    .map((request) => gate.evaluate(request))
    .reduce((worst, each) =>
      EFFECT_PRECEDENCE[each.effect] > EFFECT_PRECEDENCE[worst.effect] ? each : worst,
    );
  // The verb table's way forward where a rule only said to ask, the same one a seam prints.
  const fromTable = resolveShellLine(action, env).actions.find(
    (each) => each.alternative !== undefined,
  );
  const alternative = alternativeFor(
    verdict.alternative,
    fromTable?.alternative,
    fromTable?.action ?? action,
  );
  return { verdict, alternative, refused: fromTable?.action };
}

/**
 * Classified exactly as a seam would: the whole line through the shell resolver, so a
 * redirect or a second command is ruled on, and each with the class a rule narrows by.
 */
function requestsFor(
  input: string,
  options: DryRunOptions,
  env: NodeJS.ProcessEnv,
): ActionRequest[] {
  const where = placeOf(options);
  // Already a namespaced action, e.g. from a git hook.
  if (!input.includes(' ') && input.includes('.')) {
    const toolClass = options.class ?? classOfAction(input);
    return [
      {
        action: input,
        ...where,
        ...(options.target === undefined ? {} : { target: options.target }),
        ...(toolClass === undefined ? {} : { toolClass }),
      },
    ];
  }
  const actions = resolveShellLine(input, env).actions;
  if (actions.length === 0) return [{ action: input, ...where }];
  return actions.flatMap((resolved) => {
    const common = {
      action: resolved.action,
      ...where,
      toolClass: options.class ?? String(resolved.class),
      ...(resolved.method === undefined
        ? {}
        : { arguments: { [HTTP_METHOD_ARGUMENT]: resolved.method } }),
    };
    if (options.target !== undefined) return [{ ...common, target: options.target }];
    // One per file named, through the shell seam's own helper, so this stays a dry run.
    return targetsRuledOn(resolved).map((target) => ({
      ...common,
      ...(target === undefined ? {} : { target }),
    }));
  });
}

/** The folder and project a seam would send with the action. */
function placeOf(
  options: DryRunOptions,
): Pick<ActionRequest, 'workingDirectory' | 'projectId'> {
  return {
    ...(options.workingDirectory === undefined
      ? {}
      : { workingDirectory: options.workingDirectory }),
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
  };
}

/** The class a seam would send for an action named outright: its verb, or its tool name. */
function classOfAction(action: string): string | undefined {
  const verb = verbForAction(action, verbTableFor);
  if (verb !== null) return verb.class;
  if (!action.startsWith('mcp.')) return undefined;
  const parts = action.split('.');
  const tool = parts.pop() ?? '';
  // `mcp.<server>.<tool>` names its server, which the hook reads Memnox's own tools by.
  const server = parts.length === 2 ? (parts[1] ?? '') : '*';
  return classifyToolCall(tool, {}, ownToolDeclaration(server, tool)).class;
}

/**
 * What to do, in the rule's words, with the action beside it where it names another one.
 * The verb table's way forward is filed under the refused action, which is no help to repeat.
 */
export function insteadOf(alternative: Alternative, refused: string | undefined): string {
  if (alternative.action === refused) return alternative.note;
  const action =
    alternative.resource === undefined
      ? alternative.action
      : `${alternative.action} ${alternative.resource}`;
  return alternative.note === alternative.action
    ? action
    : `${alternative.note} (${action})`;
}
