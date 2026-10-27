import {
  DAEMON_METHOD,
  FAST_INTERCEPT_VERSION,
  INTERCEPT_METHOD,
  INTERCEPT_PLAN,
  openLedger,
  type DaemonRequest,
  type DaemonResponse,
  type EventSink,
  type SessionPause,
  redactSecrets,
} from '@memnox/core';
import {
  finishedRow,
  observeSession,
  pauseMessage,
  planIntercept,
  record,
  type FastPlan,
  type FastScene,
  type PendingRun,
  type RecordInput,
} from '@memnox/interceptors';

/**
 * The daemon's side of the native wrapper. A row is written only once the client says it
 * acted on the plan, so a client that gave up waiting and ran the Node interceptor instead
 * is never recorded twice.
 */

interface InterceptSurfaceDeps {
  home: string;
  /** The breaker's RECORD, so a fast command is counted as a Node one is. */
  report: (request: DaemonRequest) => void;
  plan?: (scene: FastScene) => Promise<FastPlan>;
  sink?: () => EventSink | null;
  observe?: (sessionId: string | undefined) => Promise<SessionPause | null>;
  log: (message: string) => void;
}

type Reply = (response: DaemonResponse) => void;

interface Waiting {
  plan: FastPlan;
  acted: boolean;
}

export class InterceptSurface {
  /** One plan per connection, since a client opens one per command. */
  private readonly waiting = new Map<object, Waiting>();
  private ledger: EventSink | null | undefined;

  constructor(private readonly deps: InterceptSurfaceDeps) {}

  async respond(connection: object, request: DaemonRequest, reply: Reply): Promise<void> {
    if (request.method === INTERCEPT_METHOD.INTERCEPT) {
      reply(await this.intercept(connection, request));
      return;
    }
    const waiting = this.waiting.get(connection);
    // Answered by no line, so the client can write it and run without waiting.
    if (request.method === INTERCEPT_METHOD.INTERCEPT_ACTED) {
      if (waiting === undefined) return;
      waiting.acted = true;
      if (waiting.plan.kind !== INTERCEPT_PLAN.RUN) {
        this.waiting.delete(connection);
        await this.writeRefusal(waiting.plan);
      }
      return;
    }
    if (request.method === INTERCEPT_METHOD.INTERCEPT_RAN) {
      this.waiting.delete(connection);
      if (waiting?.plan.kind !== INTERCEPT_PLAN.RUN) {
        reply({ id: request.id, ok: false, error: 'nothing was planned to run here' });
        return;
      }
      const notes = await this.finish(waiting.plan.pending, request.exitCode);
      reply({ id: request.id, ok: true, notes });
    }
  }

  /** A client that hung up after acting still ran the command, so its row is kept without an exit code. */
  async drop(connection: object): Promise<void> {
    const waiting = this.waiting.get(connection);
    this.waiting.delete(connection);
    if (waiting === undefined || !waiting.acted) return;
    if (waiting.plan.kind === INTERCEPT_PLAN.RUN) {
      await record(this.sink(), finishedRow(waiting.plan.pending, undefined));
    }
  }

  private async intercept(
    connection: object,
    request: DaemonRequest,
  ): Promise<DaemonResponse> {
    const scene = sceneOf(request);
    if (scene === null) return nodePlan(request.id);
    let plan: FastPlan;
    try {
      plan = await (
        this.deps.plan ?? ((each) => planIntercept(each, { home: this.deps.home }))
      )(scene);
    } catch (err) {
      // A plan that threw is a doubt, and every doubt goes to the Node interceptor.
      // The error can quote the command it was planning, and a log outlives the plan.
      this.deps.log(`fast intercept fell back: ${redactSecrets(String(err))}`);
      return nodePlan(request.id);
    }
    if (plan.kind === INTERCEPT_PLAN.RUN || plan.kind === INTERCEPT_PLAN.REFUSE) {
      this.waiting.set(connection, { plan, acted: false });
    }
    return answerFor(request.id, plan);
  }

  private async writeRefusal(plan: FastPlan): Promise<void> {
    if (plan.kind !== INTERCEPT_PLAN.REFUSE || plan.row === undefined) return;
    await record(this.sink(), plan.row);
  }

  /** The breaker first, then the row, then the replay, in the order the Node path keeps. */
  private async finish(
    pending: PendingRun,
    exitCode: number | undefined,
  ): Promise<string[]> {
    const row: RecordInput = finishedRow(pending, exitCode);
    const { outcome, sessionId } = pending.row;
    this.deps.report({
      id: 0,
      method: DAEMON_METHOD.RECORD,
      action: outcome.action,
      ...(outcome.target === undefined ? {} : { target: outcome.target }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(pending.outOfScope ? { outOfScope: true } : {}),
    });
    await record(this.sink(), row);
    const observe =
      this.deps.observe ??
      ((session: string | undefined) =>
        observeSession({ home: this.deps.home, sessionId: session }));
    const tripped = await observe(sessionId);
    return tripped === null ? [] : [pauseMessage(tripped)];
  }

  /** Opened once and kept, since a daemon writes rows all day. */
  private sink(): EventSink | null {
    if (this.ledger === undefined) {
      this.ledger = (this.deps.sink ?? (() => openLedger(this.deps.home)))();
    }
    return this.ledger;
  }
}

function nodePlan(id: number): DaemonResponse {
  return { id, ok: true, fast: FAST_INTERCEPT_VERSION, plan: INTERCEPT_PLAN.NODE };
}

function answerFor(id: number, plan: FastPlan): DaemonResponse {
  const head = { id, ok: true, fast: FAST_INTERCEPT_VERSION, plan: plan.kind };
  if (plan.kind === INTERCEPT_PLAN.NODE) return head;
  if (plan.kind === INTERCEPT_PLAN.PASS)
    return { ...head, real: plan.real, path: plan.path };
  if (plan.kind === INTERCEPT_PLAN.REFUSE) {
    return { ...head, notes: plan.notes, exitCode: plan.exitCode };
  }
  return { ...head, real: plan.real, path: plan.path, notes: plan.notes };
}

/** Null for anything not shaped exactly as this version sends it, which the client hears as `node`. */
export function sceneOf(request: DaemonRequest): FastScene | null {
  const { fast, argv, env, cwd, ppid } = request;
  if (fast !== FAST_INTERCEPT_VERSION) return null;
  if (!Array.isArray(argv) || argv.length === 0) return null;
  if (!argv.every((each) => typeof each === 'string')) return null;
  if (typeof cwd !== 'string' || typeof ppid !== 'number') return null;
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return null;
  if (!Object.values(env).every((each) => typeof each === 'string')) return null;
  return { argv, env: { ...env }, cwd, ppid };
}
