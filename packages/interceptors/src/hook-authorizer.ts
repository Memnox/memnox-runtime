import {
  DECISION_EFFECT,
  PROTECTION_STOPPED_REASON,
  describeAlternative,
  describeEnvironment,
  describeEgress,
  inspectEgress,
  projectIdAt,
  type ActionRequest,
  type Alternative,
  type DecisionEffect,
  type LocalGate,
  SCOPE_MATCH,
} from '@memnox/core';

import { EGRESS_ACTIONS } from './tool-hook.constants';

/**
 * The verdict a hook gets: egress first, then the local rules, in-process, so a local
 * refusal never becomes a network request and its arguments stay on this machine.
 */
export interface HookVerdict {
  effect: DecisionEffect;
  reason: string;
  /** What the agent may use instead, carried into the denial the model reads. */
  alternative?: Alternative;
  /** The rule that matched, so a reported verdict cites rather than asserts. */
  rule?: string;
  /** Present when a person has to answer; printed so the terminal can resolve it. */
  approvalId?: string;
  /** The verdict this came from, so a hooked call joins its decision in the ledger. */
  decisionId?: string;
  /** What an observed rule would have decided, had it been enforcing. */
  shadowEffect?: DecisionEffect;
  /** The environment the call named, so the refusal says where it would have landed. */
  environment?: string;
  /** Outside the task the session declared, which the circuit breaker counts. */
  outOfScope?: boolean;
  /** What the gate found, as ids, so the row can say which part of the context decided. */
  signals?: readonly string[];
  /** The person this was ruled for, as the run named them. */
  principal?: string;
}

export interface HookAuthorizerDeps {
  /** Evaluated in-process against this machine's policy files; sees the arguments. */
  gate?: LocalGate;
  /** True while `memnox stop` holds. Absent means never, which is right for a test. */
  stopped?: () => Promise<boolean>;
  /** The project an action in a folder belongs to, so a rule scoped to one can decide it. */
  projectAt?: (cwd: string) => Promise<string | undefined>;
  /** Where this seam runs, for a request that names no folder of its own. */
  workingDirectory?: string;
}

export class HookAuthorizer {
  /** One lookup per folder, since a seam asks for every request of one call. */
  private readonly projects = new Map<string, Promise<string | undefined>>();

  constructor(private readonly deps: HookAuthorizerDeps) {}

  /** A hook's: its gate, and the project of the folder each call names, read from this home. */
  static forHome(home: string, gate: LocalGate | null): HookAuthorizer {
    return new HookAuthorizer({
      ...(gate === null ? {} : { gate }),
      projectAt: (cwd) => projectIdAt(home, cwd),
    });
  }

  async authorize(given: ActionRequest): Promise<HookVerdict> {
    // Asked per call, so a stop or a start reaches a long-lived proxy at its next request.
    if (this.deps.stopped !== undefined && (await this.deps.stopped())) {
      return { effect: DECISION_EFFECT.ALLOW, reason: PROTECTION_STOPPED_REASON };
    }
    const request = await this.inProject(given);
    // Destination and payload both: an allowed host
    // carrying a credential is still a refusal.
    const leaking = this.egress(request);
    if (leaking !== null) return leaking;
    return (
      this.locally(request) ?? {
        effect: DECISION_EFFECT.ALLOW,
        reason: 'no rules configured',
      }
    );
  }

  /** The request with the project of the folder it runs in, unless it named one already. */
  private async inProject(request: ActionRequest): Promise<ActionRequest> {
    const projectAt = this.deps.projectAt;
    const cwd = request.workingDirectory ?? this.deps.workingDirectory;
    if (request.projectId !== undefined || projectAt === undefined || cwd === undefined)
      return request;
    let found = this.projects.get(cwd);
    if (found === undefined) {
      found = projectAt(cwd);
      this.projects.set(cwd, found);
    }
    const projectId = await found;
    return projectId === undefined ? request : { ...request, projectId };
  }

  /** Marks the session wary of what it reads, where the gate has a session to mark. */
  taint(source: string): boolean {
    return this.deps.gate?.taint(source) ?? false;
  }

  /** A person said yes to what was asked, so the same new thing is not asked twice. */
  personAllowed(request?: ActionRequest): void {
    this.deps.gate?.personAllowed(request);
  }

  // Nothing is modified: silently stripping a payload is a bug nobody can audit.
  private egress(request: ActionRequest): HookVerdict | null {
    if (!EGRESS_ACTIONS.includes(request.action)) return null;
    const fields = request.arguments;
    if (fields === undefined) return null;

    const inspection = inspectEgress({
      ...(request.target === undefined ? {} : { destination: request.target }),
      fields,
    });
    if (inspection.findings.length === 0) return null;

    return {
      effect: DECISION_EFFECT.DENY,
      reason: describeEgress(inspection),
      alternative: {
        action: request.action,
        note: 'send the request without that field, or reference the value by name',
      },
    };
  }

  /** Null when no policy files were configured, which leaves the runtime as the gate. */
  private locally(request: ActionRequest): HookVerdict | null {
    const gate = this.deps.gate;
    if (gate === undefined) return null;

    const verdict = gate.evaluate(request);
    const rule = verdict.matchedPolicies[0];
    return {
      effect: verdict.effect,
      reason: verdict.reason,
      ...(rule === undefined ? {} : { rule: rule.name }),
      ...(verdict.alternative === undefined ? {} : { alternative: verdict.alternative }),
      ...(verdict.shadowEffect === undefined
        ? {}
        : { shadowEffect: verdict.shadowEffect }),
      ...(verdict.scope?.match === SCOPE_MATCH.OUT_OF_SCOPE ? { outOfScope: true } : {}),
      signals: verdict.signals,
      ...(verdict.principal === undefined ? {} : { principal: verdict.principal }),
    };
  }
}

/**
 * A verdict as the caller reads it: the reason,
 * the way forward, and where to answer or ask why.
 */
export function describeVerdict(verdict: HookVerdict): string {
  const parts = [verdict.reason];
  const environment = describeEnvironment(verdict.environment);
  if (environment !== null) parts.push(environment);
  if (verdict.alternative !== undefined)
    parts.push(describeAlternative(verdict.alternative));
  if (verdict.approvalId !== undefined) {
    parts.push(`Ask a person: memnox approvals resolve ${verdict.approvalId} --by <you>`);
  }
  if (verdict.decisionId !== undefined)
    parts.push(`Why: memnox why ${verdict.decisionId}`);
  return parts.join(' ');
}
