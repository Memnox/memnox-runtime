/**
 * The check an agent running in somebody's cloud makes before each tool call. Allow and
 * deny are decided here, from rules already in memory, in microseconds and with no network
 * on the way; only a call a rule says to ask about waits, for a person reached through the
 * control plane, and it waits a bounded time. No model decides anything here.
 */
import { createPublicKey, randomUUID, verify } from 'node:crypto';

import {
  ACTION,
  answerHasInstructionShape,
  CHANGING_HTTP_METHODS,
  CircuitBreaker,
  DECISION_EFFECT,
  HTTP_METHOD_ARGUMENT,
  TOOL_CLASS,
  digest,
  PolicyEngine,
  policiesFrom,
  policiesFromBundle,
  recommendedAnswers,
  redactSecrets,
  setDataPatterns,
  validatePolicyDocument,
  type ActionRequest,
  type DataPattern,
  type BreakerBreach,
  type EvaluationResult,
  type Policy,
} from '@memnox/core/engine';

import { requestsFor, type CallPlace } from './actions';
import type { CloudKey, CloudPort, GuardRecord, HeldState, SignedAnswer } from './cloud';
import {
  DEFAULT_WAIT_MS,
  FIRST_RULES_MS,
  HELD_ANSWER,
  HELD_STATUS,
  LONG_POLL_SECONDS,
  RECORD_BATCH,
  RECORD_EVERY_MS,
  RECORD_KIND,
  RESUME_CHECK_MS,
  RULES_REFRESH_MS,
  VERDICT,
  type Verdict,
} from './guard.constants';

export interface GuardOptions {
  /** The agent's name in the workspace, as its rules and its owners know it. */
  agent: string;
  /** The machine class its rules are read for, `server` for a box that keeps running. */
  machineClass?: string;
  /** How long an asked call waits on a person before it is refused. */
  waitMs?: number;
  /** Refuse an answer the control plane did not sign. Off only to try a guard against a plane that cannot sign yet. */
  requireSigned?: boolean;
  /**
   * Refuse a yes that no device or passkey signed, so a chat button pressed by
   * whoever holds that chat account cannot release the call.
   */
  requireDeviceProof?: boolean;
  /** Injected so a test runs on its own clock. */
  now?: () => Date;
}

export interface CallContext extends CallPlace {
  /** The agent's session, so a "for this session" answer and the breaker stay inside it. */
  sessionId: string;
}

/** What a check came to, with everything a refusal needs to say why. */
export interface Decision {
  verdict: Verdict;
  allowed: boolean;
  reason: string;
  rule?: string;
  alternative?: string;
  /** Who answered, where a person did. */
  answeredBy?: string;
  /** What vouched for the person who answered: `device`, `passkey`, or `none` for a chat button. */
  answerProof?: string;
  /** The question's id, where one was raised, so a resumed call can find it. */
  heldId?: string;
}

export interface CallOutcome {
  failed: boolean;
  /** Distinguishes failing the same way from failing differently every time. */
  failureKind?: string;
  /** What the tool answered, read for text written to steer the agent and never kept. */
  output?: unknown;
}

/** Said when a tainted session's send or loss is put to a person, as the gateway says it. */
export const TAINTED_REASON =
  'this agent recently read text written to give it instructions, so a person decides before it speaks or loses anything';

const STRICTNESS: Readonly<Record<string, number>> = {
  [DECISION_EFFECT.ALLOW]: 0,
  [DECISION_EFFECT.ASK]: 1,
  [DECISION_EFFECT.DENY]: 2,
};

/** A session the breaker stopped, and when the guard last asked whether a person lifted it. */
interface Pause {
  breach: BreakerBreach;
  at: number;
  checkedAt: number;
}

/** The workspace's rules and the guard's own memory of answers, pauses and what to record. */
export class Guard {
  private engine: PolicyEngine;
  private bundleHash: string | null = null;
  private etag: string | null = null;
  private keys: CloudKey[] = [];
  private firstRules: Promise<void> | null = null;
  private refresher: ReturnType<typeof setInterval> | null = null;
  private recorder: ReturnType<typeof setInterval> | null = null;
  private readonly breaker = new CircuitBreaker();
  private readonly paused = new Map<string, Pause>();
  private readonly sessionGrants = new Set<string>();
  private readonly sessionsSeen = new Set<string>();
  /** Sessions that read instruction-shaped text, and the tool it came through. */
  private readonly tainted = new Map<string, string>();
  private readonly pending: GuardRecord[] = [];

  constructor(
    private readonly cloud: CloudPort,
    private readonly options: GuardOptions,
  ) {
    // The recommended rules until the workspace's arrive, so a first call is never ruled on by nothing.
    this.engine = new PolicyEngine(defaultPolicies());
  }

  /** Start fetching the rules and sending the record, each on its own timer, off every call's path. */
  start(): this {
    this.firstRules ??= this.refreshRules();
    this.refresher ??= setInterval(() => void this.refreshRules(), RULES_REFRESH_MS);
    this.recorder ??= setInterval(() => void this.flush(), RECORD_EVERY_MS);
    this.refresher.unref?.();
    this.recorder.unref?.();
    return this;
  }

  /** Stop the timers and send what is left, for a function about to end. */
  async close(): Promise<void> {
    if (this.refresher !== null) clearInterval(this.refresher);
    if (this.recorder !== null) clearInterval(this.recorder);
    this.refresher = null;
    this.recorder = null;
    await this.flush();
  }

  /** The verdict on one tool call, deciding locally and asking a person only where a rule says to. */
  async authorize(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    context: CallContext,
  ): Promise<Decision> {
    await this.rulesReady();
    this.noteSession(context.sessionId);
    const pause = await this.stillPaused(context.sessionId);
    if (pause !== null) {
      return this.settle(
        tool,
        input,
        context,
        pausedDecision(pause.breach),
        DECISION_EFFECT.DENY,
      );
    }
    const requests = requestsFor(tool, input, context);
    if (requests.length === 0) {
      return this.settle(
        tool,
        input,
        context,
        allowed('nothing in this call is ruled on'),
        DECISION_EFFECT.ALLOW,
      );
    }
    const strictest = this.strictest(requests, context);
    const ruled = this.steered(strictest.result, requests, tool, context);
    const effect = ruled.effect;
    if (effect === DECISION_EFFECT.ALLOW) {
      return this.settle(
        tool,
        input,
        context,
        allowed(ruled.reason, ruled),
        effect,
        strictest.request,
      );
    }
    if (effect !== DECISION_EFFECT.ASK) {
      return this.settle(
        tool,
        input,
        context,
        refused(ruled.reason, ruled),
        effect,
        strictest.request,
      );
    }
    const grant = grantKey(context.sessionId, strictest.request);
    if (this.sessionGrants.has(grant)) {
      return this.settle(
        tool,
        input,
        context,
        allowed('allowed for this session by an earlier answer', ruled),
        effect,
        strictest.request,
      );
    }
    const asked = await this.ask(strictest.request, input, context, ruled);
    if (asked.verdict === VERDICT.ALLOW && asked.grantsSession)
      this.sessionGrants.add(grant);
    return this.settle(tool, input, context, asked.decision, effect, strictest.request);
  }

  /**
   * What a call came to once it ran, for the circuit breaker: the same command failing the
   * same way five times pauses the session until a person resumes it.
   */
  outcome(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    context: CallContext,
    result: CallOutcome,
  ): void {
    if (result.output !== undefined && answerHasInstructionShape(result.output)) {
      this.taint(context.sessionId, tool);
    }
    const first = requestsFor(tool, input, context)[0];
    const action = first?.action ?? tool;
    const breach = this.breaker.observe({
      sessionId: context.sessionId,
      fingerprint: digest(
        `${action}\u0000${first?.target ?? ''}\u0000${argsDigestOf(input)}`,
      ),
      action,
      ...(first?.target === undefined ? {} : { target: first.target }),
      at: this.now().toISOString(),
      failed: result.failed,
      ...(result.failureKind === undefined ? {} : { failureKind: result.failureKind }),
    });
    if (breach === null) return;
    const at = this.now().getTime();
    this.paused.set(context.sessionId, { breach, at, checkedAt: at });
    this.pending.push({
      kind: RECORD_KIND.SESSION_PAUSED,
      dedupKey: `pause:${context.sessionId}:${at}`,
      subjectId: context.sessionId,
      actorType: 'agent',
      occurredAt: at,
      agentSessionId: context.sessionId,
      payload: { agentId: this.options.agent, reason: redactSecrets(breach.reason) },
    });
  }

  /**
   * The pause on this session, unless a person lifted it from their phone, Mac
   * or the console since. Asked at most once a window, and a plane that cannot
   * be reached leaves the pause in place: a stuck loop stays stopped.
   */
  private async stillPaused(sessionId: string): Promise<Pause | null> {
    const pause = this.paused.get(sessionId);
    if (pause === undefined) return null;
    const now = this.now().getTime();
    if (now - pause.checkedAt < RESUME_CHECK_MS) return pause;
    pause.checkedAt = now;
    try {
      if (await this.cloud.resumedSince(sessionId, pause.at)) {
        this.resume(sessionId);
        return null;
      }
    } catch {
      // Unreachable is not a resume.
    }
    return pause;
  }

  /**
   * Marks a session as having read text that addresses the model, so from now on its
   * sends, posts and losses ask a person even where a rule allows them. The rule trusted
   * the agent, not what it just read. A hook that reads results itself calls this.
   */
  taint(sessionId: string, source: string): void {
    if (!this.tainted.has(sessionId)) this.tainted.set(sessionId, source);
  }

  /** The tool the session's instruction-shaped text came through, or null where none has. */
  taintedBy(sessionId: string): string | null {
    return this.tainted.get(sessionId) ?? null;
  }

  /** An allow turned into an ask, where a tainted session is about to speak or lose something. */
  private steered(
    ruled: EvaluationResult,
    requests: readonly ActionRequest[],
    tool: string,
    context: CallContext,
  ): EvaluationResult {
    if (ruled.effect !== DECISION_EFFECT.ALLOW) return ruled;
    if (!this.tainted.has(context.sessionId)) return ruled;
    if (!requests.some((request) => steerable(request, tool))) return ruled;
    return { ...ruled, effect: DECISION_EFFECT.ASK, reason: TAINTED_REASON };
  }

  /** Lift a pause, as a person resuming the session does. */
  resume(sessionId: string): void {
    this.paused.delete(sessionId);
    this.breaker.forget(sessionId);
  }

  /** Send what has been decided since the last send. Never throws: a lost record must not stop the agent. */
  async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, RECORD_BATCH);
      try {
        await this.cloud.record(batch);
      } catch {
        // Put back for the next send; the record catches up when the plane does.
        this.pending.unshift(...batch);
        return;
      }
    }
  }

  private strictest(
    requests: readonly ActionRequest[],
    context: CallContext,
  ): { request: ActionRequest; result: EvaluationResult } {
    const ruled = requests.map((request) => ({
      request,
      result: this.engine.evaluate(
        { ...request, sessionId: context.sessionId, principal: this.options.agent },
        { agentName: this.options.agent, now: this.now() },
      ),
    }));
    return ruled.reduce((worst, next) =>
      (STRICTNESS[next.result.effect] ?? 0) > (STRICTNESS[worst.result.effect] ?? 0)
        ? next
        : worst,
    );
  }

  private async ask(
    request: ActionRequest,
    input: Readonly<Record<string, unknown>>,
    context: CallContext,
    ruled: EvaluationResult,
  ): Promise<{ verdict: Verdict; grantsSession: boolean; decision: Decision }> {
    const argsDigest = argsDigestOf(input);
    const waitMs = this.options.waitMs ?? DEFAULT_WAIT_MS;
    const deadline = this.now().getTime() + waitMs;
    try {
      const raised = await this.cloud.raise({
        operation: request.action,
        ...(request.target === undefined
          ? {}
          : { target: redactSecrets(request.target) }),
        argsDigest,
        agent: this.options.agent,
        sessionId: context.sessionId,
        reason: ruled.reason,
        operationId: digest(
          `${context.sessionId}\u0000${request.action}\u0000${request.target ?? ''}\u0000${argsDigest}`,
        ),
        waitMinutes: Math.max(1, Math.ceil(waitMs / 60_000)),
        ...(ruled.rule === undefined ? {} : { ruleId: ruled.rule.id }),
      });
      for (;;) {
        const left = Math.ceil((deadline - this.now().getTime()) / 1000);
        if (left <= 0) break;
        const state = await this.cloud.status(
          raised.id,
          Math.min(LONG_POLL_SECONDS, left),
        );
        if (state.status === HELD_STATUS.EXPIRED) break;
        if (state.status === HELD_STATUS.ANSWERED)
          return await this.answered(state, raised.id, argsDigest, ruled);
      }
      return refusedAsk(
        `nobody answered within ${Math.round(waitMs / 1000)} seconds, so it was not run`,
        ruled,
        raised.id,
      );
    } catch {
      return refusedAsk(
        'the control plane could not be reached to ask a person, so it was not run',
        ruled,
      );
    }
  }

  private async answered(
    state: HeldState,
    id: string,
    argsDigest: string,
    ruled: EvaluationResult,
  ): Promise<{ verdict: Verdict; grantsSession: boolean; decision: Decision }> {
    const requireSigned = this.options.requireSigned ?? true;
    if (
      requireSigned &&
      !(await this.signedFor(state.signed, id, argsDigest, state.answer))
    ) {
      return refusedAsk(
        'the answer was not signed by the control plane, so it was not trusted',
        ruled,
        id,
      );
    }
    const by = `${state.by ?? 'a person'}${state.door === undefined ? '' : ` on ${state.door}`}`;
    const proof = proofIn(state.signed);
    if (state.answer === HELD_ANSWER.ONCE || state.answer === HELD_ANSWER.SESSION) {
      if (this.options.requireDeviceProof === true && proof === NO_PROOF) {
        return refusedAsk(
          `allowed by ${by}, but no device or passkey signed it, so it was not trusted`,
          ruled,
          id,
          by,
        );
      }
      return {
        verdict: VERDICT.ALLOW,
        grantsSession: state.answer === HELD_ANSWER.SESSION,
        decision: {
          ...allowed(`allowed by ${by}`, ruled),
          answeredBy: by,
          answerProof: proof,
          heldId: id,
        },
      };
    }
    return refusedAsk(`denied by ${by}`, ruled, id, by);
  }

  /** Whether the answer is the plane's signature over this call, this answer and these arguments. */
  private async signedFor(
    signed: SignedAnswer | undefined,
    id: string,
    argsDigest: string,
    answer: string | undefined,
  ): Promise<boolean> {
    if (signed === undefined) return false;
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(signed.payload) as Record<string, unknown>;
    } catch {
      // A payload that is not JSON names no call it could vouch for.
      return false;
    }
    if (claims['callId'] !== id || claims['answer'] !== answer) return false;
    // A yes signed for other arguments is not a yes for these.
    if (claims['argsDigest'] !== argsDigest) return false;
    const key = await this.keyFor(signed.keyId);
    if (key === null) return false;
    try {
      return verify(
        null,
        Buffer.from(signed.payload, 'utf8'),
        createPublicKey({
          key: Buffer.from(key.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(signed.signature, 'base64'),
      );
    } catch {
      // A key or signature that will not parse proves nothing.
      return false;
    }
  }

  private async keyFor(keyId: string): Promise<CloudKey | null> {
    const known = this.keys.find((key) => key.keyId === keyId);
    if (known !== undefined) return known;
    try {
      this.keys = await this.cloud.keys();
    } catch {
      // Without the key, nothing signed with it can be believed.
      return null;
    }
    return this.keys.find((key) => key.keyId === keyId) ?? null;
  }

  private async refreshRules(): Promise<void> {
    try {
      const fetched = await this.cloud.bundle(this.etag);
      if (fetched === null) return;
      if (!(await this.bundleSigned(fetched.signature, fetched.body))) return;
      this.engine = new PolicyEngine([
        ...defaultPolicies(),
        ...policiesFromBundle(fetched.bundle, this.options.machineClass),
      ]);
      // The workspace's own words for what must not leave, read by every call from now on.
      setDataPatterns(
        WORKSPACE_PATTERNS,
        workspacePatterns(fetched.bundle.classifications),
      );
      this.bundleHash = fetched.bundle.hash;
      this.etag = fetched.etag;
    } catch {
      // The rules in memory keep deciding; the next refresh tries again.
    }
  }

  /** A bundle is taken only signed, where signatures are required, so a forged one changes nothing. */
  private async bundleSigned(signature: string | null, body: string): Promise<boolean> {
    if (!(this.options.requireSigned ?? true)) return true;
    if (signature === null) return false;
    const at = signature.indexOf(':');
    if (at <= 0) return false;
    const key = await this.keyFor(signature.slice(0, at));
    if (key === null) return false;
    try {
      return verify(
        null,
        Buffer.from(body, 'utf8'),
        createPublicKey({
          key: Buffer.from(key.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(signature.slice(at + 1), 'base64'),
      );
    } catch {
      // A signature that will not parse proves nothing.
      return false;
    }
  }

  /** Waits for the first rules a bounded time, then decides with what it has. */
  private async rulesReady(): Promise<void> {
    if (this.firstRules === null) this.start();
    await Promise.race([
      this.firstRules,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FIRST_RULES_MS);
        timer.unref?.();
      }),
    ]);
  }

  private noteSession(sessionId: string): void {
    if (this.sessionsSeen.has(sessionId)) return;
    this.sessionsSeen.add(sessionId);
    this.pending.push({
      kind: RECORD_KIND.SESSION_STARTED,
      dedupKey: `session:${sessionId}`,
      subjectId: sessionId,
      actorType: 'agent',
      occurredAt: this.now().getTime(),
      agentSessionId: sessionId,
      payload: { agentId: this.options.agent, agentKind: this.options.agent },
    });
  }

  /** Records the decision off the call's path and hands it back. */
  private settle(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    context: CallContext,
    decision: Decision,
    effect: string,
    request?: ActionRequest,
  ): Decision {
    const id = randomUUID();
    this.pending.push({
      kind: RECORD_KIND.ACTION_RECORDED,
      dedupKey: id,
      subjectId: id,
      actorType: 'agent',
      occurredAt: this.now().getTime(),
      agentSessionId: context.sessionId,
      payload: {
        agentId: this.options.agent,
        surface: 'cloud',
        operation: request?.action ?? tool,
        classes: [request?.toolClass ?? 'unknown'],
        ...(request?.target === undefined
          ? {}
          : { resourceRef: redactSecrets(request.target) }),
        argsDigest: argsDigestOf(input),
        effect,
        finalEffect: decision.verdict,
        reason: redactSecrets(decision.reason),
        ...(decision.rule === undefined ? {} : { ruleId: decision.rule }),
        ...(this.bundleHash === null ? {} : { bundleHash: this.bundleHash }),
        ...(decision.alternative === undefined
          ? {}
          : { alternative: decision.alternative }),
      },
    });
    return decision;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

/** Verbs that open a tool's name when the call speaks to somebody or hands something over. */
const SENDING_VERBS: ReadonlySet<string> = new Set([
  'send',
  'post',
  'publish',
  'email',
  'mail',
  'forward',
  'upload',
  'share',
  'notify',
  'reply',
  'message',
  'transfer',
  'invite',
]);

/** The verb a tool's own name opens with, past an MCP server's prefix and in any case style. */
function leadingVerb(tool: string): string {
  const name = tool.split('__').pop() ?? tool;
  return (name.split(/[._\s-]|(?=[A-Z])/)[0] ?? '').toLowerCase();
}

/** What a steered agent could be talked into: speaking, losing something, or carrying a customer out. */
function steerable(request: ActionRequest, tool: string): boolean {
  if (request.dataClassification !== undefined) return true;
  if (
    request.toolClass === TOOL_CLASS.COMMUNICATION ||
    request.toolClass === TOOL_CLASS.DESTRUCTIVE
  ) {
    return true;
  }
  const method = request.arguments?.[HTTP_METHOD_ARGUMENT];
  if (
    request.action === ACTION.HTTP_REQUEST &&
    method !== undefined &&
    CHANGING_HTTP_METHODS.includes(method.toUpperCase())
  ) {
    return true;
  }
  return SENDING_VERBS.has(leadingVerb(tool));
}

/** The source a workspace's patterns are kept under, beside any a policy file adds. */
const WORKSPACE_PATTERNS = 'workspace';

/** Only the patterns the validator takes, so one bad regex from the plane cannot match everything. */
function workspacePatterns(published: readonly DataPattern[] | undefined): DataPattern[] {
  if (published === undefined || published.length === 0) return [];
  try {
    return (
      validatePolicyDocument({ version: 1, policies: [], classifications: published })
        .classifications ?? []
    );
  } catch {
    // Patterns that will not validate add nothing rather than taking the rules down with them.
    return [];
  }
}

function defaultPolicies(): Policy[] {
  return policiesFrom(recommendedAnswers());
}

/** An answer no device or passkey signed: a chat button, which vouches only for the chat account. */
const NO_PROOF = 'none';

/** The proof the plane signed into the answer; read from the signed bytes, never the unsigned fields. */
function proofIn(signed: HeldState['signed']): string {
  if (signed === undefined) return NO_PROOF;
  try {
    const claims = JSON.parse(signed.payload) as Record<string, unknown>;
    return typeof claims['proof'] === 'string' ? claims['proof'] : NO_PROOF;
  } catch {
    // Unreadable bytes vouch for nobody.
    return NO_PROOF;
  }
}

/** The arguments as a digest, the only form of them that ever leaves the agent. */
export function argsDigestOf(input: Readonly<Record<string, unknown>>): string {
  return digest(JSON.stringify(input, Object.keys(input).sort()));
}

function grantKey(sessionId: string, request: ActionRequest): string {
  return `${sessionId}\u0000${request.action}\u0000${request.target ?? ''}`;
}

function allowed(reason: string, ruled?: EvaluationResult): Decision {
  return {
    verdict: VERDICT.ALLOW,
    allowed: true,
    reason,
    ...(ruled?.rule === undefined ? {} : { rule: ruled.rule.name }),
  };
}

function refused(reason: string, ruled: EvaluationResult): Decision {
  return {
    verdict: VERDICT.DENY,
    allowed: false,
    reason,
    ...(ruled.rule === undefined ? {} : { rule: ruled.rule.name }),
    ...(ruled.alternative === undefined ? {} : { alternative: ruled.alternative.note }),
  };
}

function refusedAsk(
  why: string,
  ruled: EvaluationResult,
  heldId?: string,
  by?: string,
): { verdict: Verdict; grantsSession: boolean; decision: Decision } {
  return {
    verdict: VERDICT.DENY,
    grantsSession: false,
    decision: {
      ...refused(`${ruled.reason.replace(/\.\s*$/, '')}: ${why}`, ruled),
      ...(heldId === undefined ? {} : { heldId }),
      ...(by === undefined ? {} : { answeredBy: by }),
    },
  };
}

function pausedDecision(breach: BreakerBreach): Decision {
  return {
    verdict: VERDICT.DENY,
    allowed: false,
    reason: `Memnox paused this session: ${breach.reason}. Nothing further will run until a person looks at it.`,
  };
}
