import {
  DECISION_EFFECT,
  type DaemonRequest,
  type DaemonResponse,
  type LocalGate,
  type ProjectLookup,
  type ViolationMemory,
} from '@memnox/core';

/**
 * The rules' part of the daemon's EVALUATE, ruled on in the project of the folder the call
 * names, so a project's rules decide here exactly as they do at a hook.
 */

interface RuleVerdictInput {
  gate: LocalGate | undefined;
  violations: ViolationMemory;
  request: DaemonRequest;
  action: string;
  now: string;
  /** Resolved by the daemon from the folder; a client never names its own project. */
  projectId?: string;
}

/**
 * The project of the folder an EVALUATE names, or undefined: no folder, no lookup, or none
 * found all leave the machine's rules deciding alone, which is never fewer rules.
 */
export async function projectOfRequest(
  request: DaemonRequest,
  projectAt: ProjectLookup | undefined,
): Promise<string | undefined> {
  const cwd = request.workingDirectory;
  if (cwd === undefined || cwd === '' || projectAt === undefined) return undefined;
  return projectAt(cwd).catch((): undefined => undefined);
}

export function ruleVerdictFor(input: RuleVerdictInput): DaemonResponse {
  const { gate, violations, request, action, projectId } = input;
  if (gate === undefined) {
    return {
      id: request.id,
      ok: true,
      effect: DECISION_EFFECT.ALLOW,
      reason: 'no rules configured',
    };
  }
  const target = request.target === undefined ? {} : { target: request.target };
  const { dataClassification, workingDirectory } = request;
  const verdict = gate.evaluate({
    action,
    ...target,
    dataClassification,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(projectId === undefined ? {} : { projectId }),
  });
  if (verdict.effect === DECISION_EFFECT.ALLOW) {
    return { id: request.id, ok: true, effect: verdict.effect, reason: verdict.reason };
  }

  const seen = violations.record({ action, at: input.now, ...target });
  const repeated = violations.isRepeated(action, request.target)
    ? ` (asked ${seen} times now, so the rule may not match how this work is done)`
    : '';
  return {
    id: request.id,
    ok: true,
    effect: verdict.effect,
    reason: `${verdict.reason}${repeated}`,
    ...(verdict.alternative === undefined ? {} : { alternative: verdict.alternative }),
  };
}
