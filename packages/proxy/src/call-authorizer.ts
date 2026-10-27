import {
  alternativeFor,
  classifyToolCall,
  databaseToolCall,
  LocalGate,
  withStatement,
  type DatabaseToolCall,
  environmentOfArguments,
  DECISION_EFFECT,
  PROTECTION_STOPPED_REASON,
  type ActionRequest,
  type Alternative,
  type DecisionEffect,
  type LocalVerdict,
  withOutgoingData,
} from '@memnox/core';

import { fixedGate, type GateSource } from './live-gate';
import { operationFor } from './ledger';
import type { ToolManifest } from './tool-manifest';
import { heldReason, type SessionLimits } from './session-limits';
import type { ToolCall } from './tool-call';

/**
 * Whether one tool call may proceed, as a chain: the rules are one link, and a pause, a
 * budget and another machine's claim wrap them, since each must hold with no rule file.
 */

export interface CallVerdict {
  effect: DecisionEffect;
  reason: string;
  /** What the local pass found: rule ids only, safe to send onward. */
  signals?: string[];
  /** The person this was ruled for, as the run named them. */
  principal?: string;
  /** What the agent may use instead, carried into the denial the client reads. */
  alternative?: Alternative;
  /** The verdict this came from, so a proxied call joins its decision in the ledger. */
  decisionId?: string;
  /** The rule that decided, by name, so `why` does not answer "none matched". */
  rule?: string;
}

/** Decides whether one tool call may reach the wrapped server. */
export interface CallAuthorizer {
  authorize(call: ToolCall): Promise<CallVerdict>;
  /**
   * The call it allowed has returned. Only an authorizer holding something
   * while the call runs needs this, which is the claim on outward work.
   */
  settle?(call: ToolCall): Promise<void>;
  /** The proxy is going away, so whatever is still held is let go now. */
  close?(): Promise<void>;
  /** A person allowed what this asked about, so the same new thing is not asked twice. */
  personAllowed?(call: ToolCall): void;
}

export function isCallAllowed(verdict: CallVerdict): boolean {
  return verdict.effect === DECISION_EFFECT.ALLOW;
}

/** No runtime configured, so the static tool filters are the only gate. */
export class UngovernedAuthorizer implements CallAuthorizer {
  async authorize(): Promise<CallVerdict> {
    return { effect: DECISION_EFFECT.ALLOW, reason: 'no runtime configured' };
  }
}

/** Outermost: while protection is stopped every call passes, asked per call so a start bites at once. */
export class StoppedAuthorizer implements CallAuthorizer {
  constructor(
    private readonly inner: CallAuthorizer,
    private readonly stopped: () => Promise<boolean>,
  ) {}

  async authorize(call: ToolCall): Promise<CallVerdict> {
    if (await this.stopped()) {
      return { effect: DECISION_EFFECT.ALLOW, reason: PROTECTION_STOPPED_REASON };
    }
    return this.inner.authorize(call);
  }

  async settle(call: ToolCall): Promise<void> {
    await this.inner.settle?.(call);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }

  personAllowed(call: ToolCall): void {
    this.inner.personAllowed?.(call);
  }
}

/** Argument-level rules without shipping the payload anywhere; see LocalGate. */
export class LocalGateAuthorizer implements CallAuthorizer {
  private readonly gates: GateSource;

  constructor(
    gate: LocalGate | GateSource,
    private readonly serverName: string,
    private readonly sessionId?: string,
    private readonly manifest?: ToolManifest,
    /** What the wrapped server was started with, which says whose database it reaches. */
    private readonly server: {
      command?: readonly string[];
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.gates = gate instanceof LocalGate ? fixedGate(gate) : gate;
  }

  async authorize(call: ToolCall): Promise<CallVerdict> {
    // Read per call, so a pause or a pulled bundle decides this call rather than the next start.
    const gate = await this.gates.current();
    if (gate === null) {
      return { effect: DECISION_EFFECT.ALLOW, reason: 'no runtime configured' };
    }
    const database = databaseToolCall(call.name, call.arguments, {
      server: this.serverName,
      ...this.server,
    });
    // Where the payload carries a customer, also ruled on at each place it is going.
    const verdict = strictestOf(
      [
        ...withOutgoingData(this.requestFor(call, database), call.arguments),
        ...(database === null ? [] : [this.statementRequest(call, database)]),
      ].map((request) => gate.evaluate(request)),
    );
    const decided = verdict.matchedPolicies[0];
    // A refusal of a statement names the bounded one, on its table, as the shell seam does.
    const alternative =
      verdict.effect === DECISION_EFFECT.ALLOW
        ? verdict.alternative
        : alternativeFor(
            verdict.alternative,
            database?.alternative,
            operationFor(call.name),
          );
    return {
      effect: verdict.effect,
      reason: verdict.reason,
      signals: verdict.signals,
      ...(verdict.principal === undefined ? {} : { principal: verdict.principal }),
      // A local refusal names its alternative too, or offline is a dead end.
      ...(alternative === undefined ? {} : { alternative }),
      ...(decided === undefined ? {} : { rule: decided.name }),
    };
  }

  personAllowed(call: ToolCall): void {
    this.gates.latest()?.personAllowed(this.requestFor(call, null));
  }

  private requestFor(call: ToolCall, database: DatabaseToolCall | null): ActionRequest {
    const environment = environmentOfArguments(call.arguments);
    return {
      ...(environment === undefined ? {} : { environment }),
      action: operationFor(call.name),
      target: this.serverName,
      // By name and statement, since the proxy keeps no manifest and a `query` can drop.
      toolClass: classifyToolCall(
        call.name,
        call.arguments,
        this.manifest?.declaration(call.name),
      ).class,
      arguments: withStatement(call.arguments, database),
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    };
  }

  /** The statement as a database client on PATH would be ruled on, last so a tie keeps the tool's name. */
  private statementRequest(call: ToolCall, database: DatabaseToolCall): ActionRequest {
    const environment = environmentOfArguments(call.arguments);
    return {
      ...(environment === undefined ? {} : { environment }),
      action: database.action,
      ...(database.target === undefined ? {} : { target: database.target }),
      toolClass: database.class,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    };
  }
}

const SEVERITY: Readonly<Record<string, number>> = {
  [DECISION_EFFECT.ALLOW]: 0,
  [DECISION_EFFECT.ASK]: 1,
  [DECISION_EFFECT.DENY]: 2,
};

/** Deny beats ask beats allow; the first of equals, which is the call as the server sees it. */
function strictestOf(verdicts: readonly LocalVerdict[]): LocalVerdict {
  return verdicts.reduce((worst, next) =>
    (SEVERITY[next.effect] ?? 0) > (SEVERITY[worst.effect] ?? 0) ? next : worst,
  );
}

/**
 * A pause and a budget, asked before the rules, around whatever
 * authorizer this proxy has. The pause first, since a budget
 * message sends somebody editing allowances, not at the loop.
 */
export class SessionLimitedAuthorizer implements CallAuthorizer {
  constructor(
    private readonly inner: CallAuthorizer,
    private readonly limits: SessionLimits,
    private readonly sessionId?: string,
  ) {}

  async authorize(call: ToolCall): Promise<CallVerdict> {
    const sessionId = this.sessionId;
    if (sessionId !== undefined && sessionId !== '') {
      const held = await this.limits.heldBy(sessionId);
      if (held !== null) {
        return { effect: DECISION_EFFECT.DENY, reason: heldReason(held) };
      }
    }

    // The action string the gate matches on, so
    // one budget covers a call and its shell twin.
    const spent = await this.limits.exhausted(operationFor(call.name), sessionId);
    if (spent !== null) return { effect: DECISION_EFFECT.DENY, reason: spent };

    return this.inner.authorize(call);
  }

  personAllowed(call: ToolCall): void {
    this.inner.personAllowed?.(call);
  }
}
