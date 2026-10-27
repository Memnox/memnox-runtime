import { connect, createServer, type Server, type Socket } from 'node:net';
import { rm } from 'node:fs/promises';
import {
  ACTOR_TYPE,
  CircuitBreaker,
  DAEMON_METHOD,
  DECISION_EFFECT,
  isInterceptMethod,
  isNamedPipe,
  describePause,
  decodeRequest,
  requestReader,
  SessionLimits,
  SessionPauses,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  exhaustedBy,
  socketPathFor,
  TOOL_CLASS,
  ViolationMemory,
  DAEMON_EVENT,
  type BreakerBreach,
  type Budget,
  type FleetSpend,
  type MemnoxEvent,
  type DaemonRequest,
  type DaemonResponse,
  type LocalGate,
  type SessionPause,
  UNNAMED_AGENT,
  UNNAMED_SESSION,
} from '@memnox/core';
import { CLI_VERSION } from './defaults';
import {
  listenOptionsFor,
  prepareAddress,
  secureAddress,
} from './daemon/daemon-endpoint';
import { InterceptSurface } from './daemon/intercept-surface';
import { write } from './daemon/socket-write';
import type { VoiceAgentRoster } from './daemon/voice-agent-calls';
import { isVoiceMethod, VoiceSurface } from './daemon/voice-surface';
import { accountSignIns } from './daemon/account-sign-ins';
import type { Brain } from './operator/brain';
import { isRemoteMethod, RemoteEndpoint, type RemoteDeps } from './remote/endpoint';

/**
 * The daemon: one process holding the rules, so a seam pays a connect rather than a file
 * read per command. Optional, because every seam falls back to evaluating in process.
 */

/**
 * Binds the address, or reports that a live daemon holds it. The bind comes first, so of two
 * daemons starting together the kernel picks one, and a file is only removed once nothing
 * answers on it, which is a socket left behind by a daemon that was killed.
 */
async function claimAddress(server: Server, address: string): Promise<boolean> {
  try {
    await bind(server, address);
    return true;
  } catch (err) {
    if (!isAddressInUse(err)) throw err;
  }
  if (await answers(address)) return false;
  // A pipe disappears with its last handle, so one in use that does not answer is held by
  // something else, and taking it over would mean trusting whoever that is.
  if (isNamedPipe(address)) {
    throw new Error(
      `Something that is not answering holds the daemon's pipe:\n  ${address}\n` +
        'Find and stop it before starting the daemon. The interceptors still evaluate in process.',
    );
  }
  await rm(address, { force: true });
  await bind(server, address);
  return true;
}

function bind(server: Server, address: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    function failed(err: Error): void {
      reject(err);
    }
    server.once('error', failed);
    server.listen(listenOptionsFor(address), () => {
      server.removeListener('error', failed);
      resolve();
    });
  });
}

function isAddressInUse(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'EADDRINUSE';
}

/** Whether a process accepts connections on the address, which only a running daemon does. */
function answers(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(address);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

interface DaemonDeps {
  gate?: LocalGate;
  limits?: SessionLimits;
  violations?: ViolationMemory;
  breaker?: CircuitBreaker;
  /** Where a pause is written, so every seam in the session sees it. */
  pauses?: SessionPauses;
  budgets?: readonly Budget[];
  /** What the rest of the fleet has spent, as of the last heartbeat. */
  fleetSpend?: readonly FleetSpend[];
  /** Spent today, read from the ledger at startup, or killing the daemon clears a budget. */
  spentAlready?: readonly MemnoxEvent[];
  now?: () => string;
  /** How often subscribers are checked for something new to hear about. */
  feedIntervalMs?: number;
  /** The person's own agent CLI, started on the first ASK and kept warm between them. */
  brain?: () => Brain;
  /** How long a quiet brain is kept before its process is let go; the conversation resumes. */
  brainIdleMs?: number;
  /** Which agents can be the voice, for the Mac app's settings. */
  voiceAgents?: VoiceAgentRoster;
  /** Told once the Mac app has connected this machine to a workspace, so sync can start without a restart. */
  onEnrolled?: () => void;
  /** The paired phones' tunnel; its relay, cloud and Noise are handed in by a test. */
  remote?: Omit<RemoteDeps, 'home' | 'now' | 'log' | 'voice'>;
  log: (message: string) => void;
}

export class MemnoxDaemon {
  private readonly limits: SessionLimits;
  private readonly violations: ViolationMemory;
  private readonly breaker: CircuitBreaker;
  private readonly pauses: SessionPauses | null;
  /** Read once per answer rather than per session, so the hot path stays a map lookup. */
  private readonly held = new Map<string, SessionPause>();
  /** Charged as they happen, on top of what the ledger already held at startup. */
  private readonly charged: MemnoxEvent[] = [];
  private server: Server | null = null;
  private voice: VoiceSurface | null = null;
  private remote: RemoteEndpoint | null = null;
  private intercepts: InterceptSurface | null = null;

  constructor(private readonly deps: DaemonDeps) {
    this.limits = deps.limits ?? new SessionLimits();
    this.violations = deps.violations ?? new ViolationMemory();
    this.breaker = deps.breaker ?? new CircuitBreaker();
    this.pauses = deps.pauses ?? null;
  }

  /**
   * The socket path once this process holds it, or null when another daemon already
   * answers there: two daemons each run an egress proxy, and whichever lost the socket
   * still hands its port to `memnox run`, which is a port the rules are not behind.
   */
  async listen(home: string): Promise<string | null> {
    // A unix socket here, and on Windows a named pipe, from the one place both are named.
    const path = socketPathFor(home);
    await prepareAddress(path);

    const server = createServer((socket) => this.serve(socket));
    if (!(await claimAddress(server, path))) return null;
    this.server = server;
    // Built on listening rather than in the constructor, because only listening names the home.
    this.intercepts = new InterceptSurface({
      home,
      report: (request) => void this.record(request),
      log: this.deps.log,
    });
    this.voice = this.voiceSurface(home);
    this.startRemote(home);
    await secureAddress(path);
    return path;
  }

  /** What the Mac app and the phones talk to, with the sign ins the app drives for the person and this machine. */
  private voiceSurface(home: string): VoiceSurface {
    const { feedIntervalMs, brain, brainIdleMs, voiceAgents, onEnrolled } = this.deps;
    return new VoiceSurface({
      home,
      now: () => this.now(),
      log: this.deps.log,
      ...(feedIntervalMs === undefined ? {} : { feedIntervalMs }),
      ...(brain === undefined ? {} : { brain }),
      ...(brainIdleMs === undefined ? {} : { brainIdleMs }),
      ...(voiceAgents === undefined ? {} : { voiceAgents }),
      ...accountSignIns(home, () => onEnrolled?.()),
      remote: {
        driving: (deviceId) => this.remote?.driving(deviceId) ?? false,
        tell: (deviceId, response) => this.remote?.tell(deviceId, response) ?? false,
      },
    });
  }

  /** The phones' tunnel, off unless sync is enrolled and a phone is paired, so a Mac with no phone opens nothing. */
  private startRemote(home: string): void {
    this.remote = new RemoteEndpoint({
      ...this.deps.remote,
      home,
      now: () => this.now(),
      log: this.deps.log,
      voice: () => this.voice,
    });
    void this.remote.start().catch((err: unknown) => {
      this.deps.log(`the phone tunnel did not start: ${String(err)}`);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    this.remote?.close();
    this.voice?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = null;
  }

  /** Lifts a hold, so `memnox resume` reaches the daemon that is enforcing it. */
  resume(sessionId: string): boolean {
    return this.held.delete(sessionId);
  }

  private serve(socket: Socket): void {
    const reader = requestReader();
    socket.setEncoding('utf8');
    // Chained, so a connection that sends two lines gets two answers in the order it asked.
    let answered: Promise<void> = Promise.resolve();
    socket.on('data', (chunk: string) => {
      const lines = reader.push(chunk);
      // Too long to be a request, so the connection ends rather than filling memory.
      if (reader.overflowed) socket.destroy();
      for (const line of lines) {
        answered = answered.then(() => this.respond(line, socket));
      }
    });
    socket.on('close', () => {
      this.voice?.drop(socket);
      // After every line already read, so a report sent just before hanging up is not lost.
      answered = answered.then(() => this.intercepts?.drop(socket));
    });
    socket.on('error', (err) => {
      // A client that hung up mid-write is ordinary; it must never take the daemon down.
      this.deps.log(`client dropped: ${String(err)}`);
    });
  }

  private async respond(line: string, socket: Socket): Promise<void> {
    const request = decodeRequest(line);
    if (request === null) {
      write(socket, { id: 0, ok: false, error: 'not a request this daemon understands' });
      return;
    }
    if (isRemoteMethod(request.method) && this.remote !== null) {
      await this.remote.respondLocal(socket, request);
      return;
    }
    // Not listening yet falls through to "no method", which the native wrapper hears as Node.
    if (isInterceptMethod(request.method) && this.intercepts !== null) {
      await this.intercepts.respond(socket, request, (response) =>
        write(socket, response),
      );
      return;
    }
    if (isVoiceMethod(request.method)) {
      if (this.voice === null) {
        write(socket, {
          id: request.id,
          ok: false,
          error: 'the daemon is not listening yet',
        });
        return;
      }
      await this.voice.respond(socket, request);
      return;
    }
    write(socket, this.answer(request));
  }

  private answer(request: DaemonRequest): DaemonResponse {
    if (request.method === DAEMON_METHOD.PING)
      return { id: request.id, ok: true, version: CLI_VERSION };
    if (request.method === DAEMON_METHOD.RECORD) return this.record(request);
    if (request.method === DAEMON_METHOD.STATUS) {
      return this.heldResponse(request) ?? { id: request.id, ok: true };
    }
    if (request.method === DAEMON_METHOD.EVALUATE) return this.evaluate(request);
    if (request.method === DAEMON_METHOD.HOLD) return { id: request.id, ok: true };
    // Refused rather than answered "ok", which a newer client would read as the method working.
    return { id: request.id, ok: false, error: `no method ${request.method}` };
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  /**
   * What happened, after it happened. The breaker watches outcomes, so this is the only
   * place its signals can be counted.
   */
  private record(request: DaemonRequest): DaemonResponse {
    const sessionId = request.sessionId ?? UNNAMED_SESSION;
    const action = request.action ?? 'unknown';
    const now = this.now();
    if (request.driftOnly === true) {
      const drift = this.breaker.observeDrift(sessionId);
      if (drift !== null)
        this.hold({ sessionId, breach: drift, lastAction: action, now });
      return { id: request.id, ok: true };
    }

    const breach = this.breaker.observe({
      sessionId,
      fingerprint: `${action}:${request.target ?? ''}`,
      action,
      ...(request.target === undefined ? {} : { target: request.target }),
      at: now,
      failed: request.exitCode !== undefined && request.exitCode !== 0,
      ...(request.exitCode === undefined
        ? {}
        : { failureKind: String(request.exitCode) }),
      ...(request.outOfScope === undefined ? {} : { outOfScope: request.outOfScope }),
      ...(request.costUsd === undefined ? {} : { costUsd: request.costUsd }),
    });
    if (breach !== null) this.hold({ sessionId, breach, lastAction: action, now });

    // Only what ran is charged, or a strict policy would exhaust the budget it protects.
    if (request.exitCode === undefined || request.exitCode === 0) {
      this.charge(sessionId, action, now);
    }
    return { id: request.id, ok: true };
  }

  /** A row shaped like the ledger's, so one domain counts both halves the same way. */
  private charge(sessionId: string, action: string, now: string): void {
    this.charged.push({
      id: `evt_daemon_${this.charged.length}`,
      schemaVersion: EVENT_SCHEMA_VERSION,
      at: now,
      sessionId,
      agent: UNNAMED_AGENT,
      actorType: ACTOR_TYPE.AGENT,
      surface: EVENT_SURFACE.SHELL,
      operation: action,
      class: TOOL_CLASS.UNKNOWN,
      effect: DECISION_EFFECT.ALLOW,
      mode: ENFORCEMENT_MODE.ENFORCE,
      reason: 'charged against a budget',
    });
  }

  /** Held in memory and on disk: the seams are other processes and have to see it. */
  private hold(input: HoldInput): void {
    const { sessionId, breach, lastAction, now } = input;
    if (this.held.has(sessionId)) return;
    const pause: SessionPause = {
      sessionId,
      signal: breach.signal,
      reason: breach.reason,
      reached: breach.reached,
      ceiling: breach.ceiling,
      pausedAt: now,
      lastAction,
    };
    this.held.set(sessionId, pause);
    this.deps.log(`paused ${sessionId}: ${breach.reason}`);
    this.voice?.broadcast({
      kind: DAEMON_EVENT.PAUSED,
      subject: sessionId,
      agent: UNNAMED_AGENT,
      summary: describePause(pause),
      at: now,
    });
    void this.pauses?.pause(pause).catch((err: unknown) => {
      // A pause that could not be written still holds here; say so rather than lose it.
      this.deps.log(`could not write the pause: ${String(err)}`);
    });
  }

  /** Non-null when this session is held. Shaped as a refusal an agent can read. */
  private heldResponse(request: DaemonRequest): DaemonResponse | null {
    const pause = this.held.get(request.sessionId ?? UNNAMED_SESSION);
    if (pause === undefined) return null;
    return {
      id: request.id,
      ok: true,
      effect: DECISION_EFFECT.DENY,
      reason: describePause(pause),
      paused: { signal: pause.signal, reason: pause.reason },
    };
  }

  /** Pause, then budget, then limits, then rules: each stops the call before the next is asked. */
  private evaluate(request: DaemonRequest): DaemonResponse {
    const action = request.action;
    if (action === undefined) {
      return { id: request.id, ok: false, error: 'evaluate needs an action' };
    }
    const call: EvaluatedCall = {
      request,
      action,
      now: this.now(),
      sessionId: request.sessionId ?? UNNAMED_SESSION,
    };
    return (
      this.heldResponse(request) ??
      this.budgetRefusal(call) ??
      this.limitRefusal(call) ??
      this.ruleVerdict(call)
    );
  }

  /** "No allowance left" and "not allowed" lead to different fixes, so a spent budget says so. */
  private budgetRefusal(call: EvaluatedCall): DaemonResponse | null {
    const budgets = this.deps.budgets ?? [];
    if (budgets.length === 0) return null;
    const spent = exhaustedBy(budgets, {
      action: call.action,
      events: [...(this.deps.spentAlready ?? []), ...this.charged],
      now: call.now,
      sessionId: call.sessionId,
      fleet: this.deps.fleetSpend ?? [],
    });
    if (spent === null) return null;
    return {
      id: call.request.id,
      ok: true,
      effect: DECISION_EFFECT.DENY,
      reason: spent.reason,
      limit: `budget:${spent.budget.name}`,
    };
  }

  /** A session already past its ceiling is stopped whatever the rules say about this call. */
  private limitRefusal(call: EvaluatedCall): DaemonResponse | null {
    const fingerprint = `${call.action}:${call.request.target ?? ''}`;
    const breach = this.limits.record(call.sessionId, fingerprint, call.now);
    if (breach === null) return null;
    return {
      id: call.request.id,
      ok: true,
      effect: DECISION_EFFECT.DENY,
      reason: breach.reason,
      limit: breach.kind,
    };
  }

  private ruleVerdict(call: EvaluatedCall): DaemonResponse {
    const { request, action } = call;
    const gate = this.deps.gate;
    if (gate === undefined) {
      return {
        id: request.id,
        ok: true,
        effect: DECISION_EFFECT.ALLOW,
        reason: 'no rules configured',
      };
    }
    const target = request.target === undefined ? {} : { target: request.target };
    const { dataClassification } = request;
    const verdict = gate.evaluate({ action, ...target, dataClassification });
    if (verdict.effect === DECISION_EFFECT.ALLOW) {
      return { id: request.id, ok: true, effect: verdict.effect, reason: verdict.reason };
    }

    const seen = this.violations.record({ action, at: call.now, ...target });
    const repeated = this.violations.isRepeated(action, request.target)
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
}

interface HoldInput {
  sessionId: string;
  breach: BreakerBreach;
  lastAction: string;
  now: string;
}

/** One evaluate request, with the defaults every step would otherwise resolve again. */
interface EvaluatedCall {
  request: DaemonRequest;
  action: string;
  now: string;
  sessionId: string;
}
