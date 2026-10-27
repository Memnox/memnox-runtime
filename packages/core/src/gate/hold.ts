import { minutesToMs } from '../domain/time';
import { MemoryGrants, type GrantSubject, type SessionGrants } from './session-grants';
import { HOLD_ANSWER, type HoldAnswer } from './answers';

export { HOLD_ANSWER, type HoldAnswer };

/**
 * Holding a call for a person while the agent waits on the other end of a pipe, so every
 * path ends in a decision: answered, timed out, or refused because nobody could be asked.
 */

export const HOLD_OUTCOME = {
  ALLOWED: 'allowed',
  DENIED: 'denied',
  /** The command was wrong. What replaces it is ruled on from the start, never trusted. */
  EDITED: 'edited',
  /** Nobody answered in time. Denied, and said differently so it reads differently. */
  TIMED_OUT: 'timed-out',
  /** No terminal to ask at. Denied, because a firewall fails closed. */
  UNATTENDED: 'unattended',
  /**
   * Nobody answered in time, so the question was kept for a person to answer later and the
   * call refused for now. The agent carries on with what does not need it and retries.
   */
  PARKED: 'parked',
} as const;

export type HoldOutcome = (typeof HOLD_OUTCOME)[keyof typeof HOLD_OUTCOME];

/** Long enough to read the prompt, short enough that a walk-away ends. */
export const DEFAULT_HOLD_TIMEOUT_MS = minutesToMs(2);

/**
 * With no terminal the answer has to reach somebody elsewhere and travel back, but a
 * shell command is blocked while it waits, so this stays under the MCP tool's thirty.
 */
export const DEFAULT_UNATTENDED_HOLD_TIMEOUT_MS = minutesToMs(10);

export interface HoldRequest {
  sessionId: string;
  agent: string;
  operation: string;
  target?: string;
  /** Identical calls share this, which is what "for this session" grants against. */
  fingerprint: string;
  reason: string;
  /** What produced the verdict, rendered by the caller. Shown, never summarised. */
  evidence?: readonly string[];
  /** The command as typed, when there is one. `[e]` edits this and nothing else. */
  command?: string;
  /** What the action does, so a yes to a delete is only ever a yes to that delete. */
  class?: string;
  /**
   * What "for this session" covers, where the operation alone is too wide: a host for a
   * web request, a server's tool for an MCP call. The operation when absent.
   */
  grantKey?: string;
  /** Where the question also waits, so a second terminal or the workspace can answer it. */
  approvalId?: string;
  /** The rule that asked, by name, so the workspace can put it to that rule's approvers. */
  rule?: string;
  /** The way forward the rule named, as the agent reads it, so a no still leaves it one. */
  alternative?: string;
  /**
   * Everything it changes stays inside the session's repository, so a yes needs no
   * fingerprint. Absent asks for one, which is every call that reaches further.
   */
  withinSession?: true;
}

export interface HoldAsked {
  answer: HoldAnswer;
  /** What the person typed instead, for HOLD_ANSWER.EDIT. */
  command?: string;
  /** Who answered, where the route that carried it knows: the terminal, a phone, the workspace. */
  by?: string;
}

/**
 * The question reached somebody and no answer came in time. Distinct from `null`, which
 * is nobody to ask, because a slow approver and a refusal have to read differently.
 */
export interface HoldUnanswered {
  unanswered: typeof HOLD_OUTCOME.TIMED_OUT | typeof HOLD_OUTCOME.PARKED;
  /** The question still waiting, so the agent and the person can name the same one. */
  approvalId?: string;
}

export function isUnanswered(
  value: HoldAsked | HoldUnanswered | null,
): value is HoldUnanswered {
  return value !== null && 'unanswered' in value;
}

/** Where the question is actually asked. Injected, so tests need no terminal. */
export interface HoldPrompt {
  /**
   * Null when there was nobody to ask, meaning no TTY or a non-interactive run. A
   * `HoldUnanswered` when somebody could have answered and nobody did in time.
   */
  ask(
    request: HoldRequest,
    timeoutMs: number,
  ): Promise<HoldAsked | HoldUnanswered | null>;
}

export interface HoldResult {
  outcome: HoldOutcome;
  answer?: HoldAnswer;
  /** Set when a session grant answered this without asking anybody. */
  fromSessionGrant?: true;
  /** The replacement command, when a person edited it. Never run without ruling on it. */
  edited?: string;
  /** This yes was the one that taught the session to stop asking about the action. */
  learned?: true;
  /** Who answered, so the row the seam writes names them rather than a bare allow. */
  by?: string;
  /** For a parked call, the question a person will answer later. */
  approvalId?: string;
}

export function isAllowed(result: HoldResult): boolean {
  return result.outcome === HOLD_OUTCOME.ALLOWED;
}

/**
 * Grants live for one session. Kept on disk where the caller is one process of many, as
 * every hook and shell wrapper is, since a grant in memory ended with the process.
 */
export class HoldService {
  constructor(
    private readonly prompt: HoldPrompt,
    private readonly timeoutMs: number = DEFAULT_HOLD_TIMEOUT_MS,
    private readonly grants: SessionGrants = new MemoryGrants(),
  ) {}

  /** Whether this call was already answered "for this session", or learned. */
  async hasSessionGrant(request: HoldRequest): Promise<boolean> {
    return this.grants.covers(holdGrantSubject(request));
  }

  async hold(request: HoldRequest): Promise<HoldResult> {
    if (await this.hasSessionGrant(request)) {
      return {
        outcome: HOLD_OUTCOME.ALLOWED,
        answer: HOLD_ANSWER.SESSION,
        fromSessionGrant: true,
      };
    }

    let asked: HoldAsked | HoldUnanswered | null;
    try {
      asked = await this.prompt.ask(request, this.timeoutMs);
    } catch {
      // A prompt that threw is one nobody saw, so it fails closed as unattended.
      return { outcome: HOLD_OUTCOME.UNATTENDED };
    }

    if (asked === null) return { outcome: HOLD_OUTCOME.UNATTENDED };
    if (isUnanswered(asked)) {
      return {
        outcome: asked.unanswered,
        ...(asked.approvalId === undefined ? {} : { approvalId: asked.approvalId }),
      };
    }
    return this.resultOf(asked, request);
  }

  private async resultOf(asked: HoldAsked, request: HoldRequest): Promise<HoldResult> {
    const answer = asked.answer;
    const by = asked.by === undefined ? {} : { by: asked.by };
    if (answer === HOLD_ANSWER.DENY) {
      return { outcome: HOLD_OUTCOME.DENIED, answer, ...by };
    }
    if (answer === HOLD_ANSWER.EDIT) return editedResult(asked, request);
    const subject = holdGrantSubject(request);
    if (answer === HOLD_ANSWER.SESSION) await this.grants.grant(subject);
    const learned = await this.grants.approved(subject);
    return {
      outcome: HOLD_OUTCOME.ALLOWED,
      answer,
      ...(learned ? { learned: true } : {}),
      ...by,
    };
  }

  /** Ends a session's grants where they are held in memory. On disk they age out. */
  forget(sessionId: string): void {
    if (this.grants instanceof MemoryGrants) this.grants.forget(sessionId);
  }
}

export function holdGrantSubject(request: HoldRequest): GrantSubject {
  return {
    sessionId: request.sessionId,
    operation: request.grantKey ?? request.operation,
    fingerprint: request.fingerprint,
    ...(request.class === undefined ? {} : { class: request.class }),
  };
}

/**
 * An edit approves nothing: the replacement goes back through the rules from the start,
 * or "[e]" would be the way around every one of them.
 */
function editedResult(asked: HoldAsked, request: HoldRequest): HoldResult {
  const edited = asked.command?.trim() ?? '';
  if (edited === '' || edited === request.command) {
    return { outcome: HOLD_OUTCOME.DENIED, answer: HOLD_ANSWER.DENY };
  }
  return { outcome: HOLD_OUTCOME.EDITED, answer: HOLD_ANSWER.EDIT, edited };
}

/** The call as a person reads it: the operation, and its target where it has one. */
export function describeHeldCall(
  request: Pick<HoldRequest, 'operation' | 'target'>,
): string {
  return request.target === undefined
    ? request.operation
    : `${request.operation} ${request.target}`;
}

/**
 * Written for the agent, which acts on it: keep going with everything else, come back to
 * this later, and do not reach the same end another way while a person has not decided.
 */
function describeParked(what: string, approvalId: string | undefined): string {
  const id = approvalId === undefined ? '' : ` as ${approvalId}`;
  return `Nobody is here to answer, so ${what} is parked${id} until a person decides. It did not run. Carry on with the parts of the task that do not need it, say in your summary that it is waiting, and try it again later: it goes through once they say yes. Do not reach the same result another way.`;
}

/** What the caller is told when a hold did not end in an allow. */
export function describeHold(result: HoldResult, request: HoldRequest): string {
  const what = describeHeldCall(request);
  if (result.outcome === HOLD_OUTCOME.DENIED) {
    // Named where the route knew, since "who refused this" is asked as often as who allowed it.
    const who = result.by === undefined ? 'A person' : `A person, ${result.by},`;
    return `${who} denied ${what}.`;
  }
  if (result.outcome === HOLD_OUTCOME.EDITED) {
    return `A person replaced that command with: ${result.edited ?? ''}`;
  }
  if (result.outcome === HOLD_OUTCOME.PARKED)
    return describeParked(what, result.approvalId);
  if (result.outcome === HOLD_OUTCOME.TIMED_OUT) {
    return `Nobody answered in time, so ${what} did not run. Ask again when someone is at the keyboard.`;
  }
  return `${what} needs a person to approve it and there is no terminal to ask at. Run the agent under "memnox run", or add a rule that allows it.`;
}
