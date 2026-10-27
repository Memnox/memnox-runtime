import { FileGrants } from './session-grants';
import {
  DEFAULT_HOLD_TIMEOUT_MS,
  DEFAULT_UNATTENDED_HOLD_TIMEOUT_MS,
  describeHeldCall,
  HOLD_OUTCOME,
  HoldService,
  isUnanswered,
  type HoldAsked,
  type HoldPrompt,
  type HoldRequest,
  type HoldUnanswered,
} from './hold';
import { PARKED_HOURS, PendingApprovals, waitForAnswer } from './pending';
import { TtyHoldPrompt } from './tty-prompt';
import { ledgerWork, WorkEvidencePrompt, type WorkReader } from './work-prompt';
import { HOUR_MS, msToSeconds } from '../domain/time';
import { readApprovalRoute } from '../config/config-store';
import type { ApprovalRoute } from '../constants/approval-route.constants';

/**
 * A held call, written down first and answered from wherever an answer turns up: this
 * terminal, a second one running `memnox approve`, or the control plane reading the file.
 */
export interface RoutedPromptDeps {
  approvals: PendingApprovals;
  /** Asked in parallel when a terminal exists. Absent on a headless machine. */
  tty?: HoldPrompt;
  /** Told where the question is waiting, so nobody has to guess the id. */
  announce?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** Whether the workspace is asked too, read when the question is raised so a change applies at once. */
  route?: () => Promise<ApprovalRoute>;
  /**
   * How long a question nobody answered is kept for later, so an agent left alone carries on
   * rather than ending its night on it. Absent drops it at the deadline, as it always did.
   */
  parkMs?: number;
}

export class RoutedHoldPrompt implements HoldPrompt {
  constructor(private readonly deps: RoutedPromptDeps) {}

  async ask(
    request: HoldRequest,
    timeoutMs: number,
  ): Promise<HoldAsked | HoldUnanswered | null> {
    const now = this.deps.now ?? Date.now;
    const askedAt = new Date(now()).toISOString();

    // Asked already and kept for later: answered from where it waits, never asked twice.
    const parked = await this.fromParked(request, askedAt);
    if (parked !== null) return parked;

    const route = await this.deps.route?.();
    const pending = await this.deps.approvals.raise(request, askedAt, timeoutMs, route);
    // The card names the id itself, so a separate line would say it twice.
    if (this.deps.tty === undefined) this.announce(pending.id, request, timeoutMs);

    // Both routes at once and the first answer wins, so neither approver waits on the other.
    const answers: Promise<HoldAsked | null>[] = [
      waitForAnswer({
        approvals: this.deps.approvals,
        id: pending.id,
        deadline: now() + timeoutMs,
        now,
        ...(this.deps.sleep === undefined ? {} : { sleep: this.deps.sleep }),
        ...(this.deps.pollMs === undefined ? {} : { intervalMs: this.deps.pollMs }),
      }).then((answer) => (answer === null ? null : { answer })),
    ];
    if (this.deps.tty !== undefined) {
      answers.push(
        this.askTty(
          this.deps.tty,
          { ...request, approvalId: pending.id },
          timeoutMs,
          pending.id,
        ),
      );
    }

    const answer = await firstAnswer(answers);
    if (answer === null && this.deps.parkMs !== undefined) {
      const until = new Date(now() + this.deps.parkMs).toISOString();
      await this.deps.approvals.park(pending.id, new Date(now()).toISOString(), until);
      return { unanswered: HOLD_OUTCOME.PARKED, approvalId: pending.id };
    }
    // Read before it is cleared, so the row this hold leaves can say who answered it.
    const settled = await this.deps.approvals.read(pending.id);
    // Cleared either way, or somebody answers it later for a command long gone.
    await this.deps.approvals.clear(pending.id);
    // Somebody could have answered and nobody did, which is a timeout and not the rule's refusal.
    if (answer === null) return { unanswered: HOLD_OUTCOME.TIMED_OUT };
    const by = settled?.answeredBy;
    return by === undefined ? answer : { ...answer, by };
  }

  /**
   * The answer a person gave while the agent was busy elsewhere, spent once and cleared, or
   * the same question still waiting. Null when this call was never parked.
   */
  private async fromParked(
    request: HoldRequest,
    moment: string,
  ): Promise<HoldAsked | HoldUnanswered | null> {
    const parked = await this.deps.approvals.parkedFor(request, moment);
    if (parked === null) return null;
    if (parked.answer === undefined) {
      return { unanswered: HOLD_OUTCOME.PARKED, approvalId: parked.id };
    }
    await this.deps.approvals.clear(parked.id);
    return {
      answer: parked.answer,
      ...(parked.answeredBy === undefined ? {} : { by: parked.answeredBy }),
    };
  }

  /** Writes the terminal's answer to the file too, so the record says who decided. */
  private async askTty(
    tty: HoldPrompt,
    request: HoldRequest,
    timeoutMs: number,
    id: string,
  ): Promise<HoldAsked | null> {
    const asked = await tty.ask(request, timeoutMs);
    // A terminal that ran out of time gives nothing, since the remote answer may still arrive.
    if (asked === null || isUnanswered(asked)) return null;
    await this.deps.approvals.answer(
      id,
      asked.answer,
      'the terminal',
      new Date((this.deps.now ?? Date.now)()).toISOString(),
    );
    return asked;
  }

  private announce(id: string, request: HoldRequest, timeoutMs: number): void {
    const say = this.deps.announce;
    if (say === undefined) return;
    const what = describeHeldCall(request);
    const seconds = msToSeconds(timeoutMs);
    say(
      `held ${what} for a person (${seconds}s): memnox approve ${id}  |  memnox deny ${id}`,
    );
  }
}

/**
 * The first real answer, giving up only when every route has. `Promise.race` would settle
 * on the first null, so an empty terminal would cancel a remote approval about to arrive.
 */
async function firstAnswer(
  answers: readonly Promise<HoldAsked | null>[],
): Promise<HoldAsked | null> {
  return new Promise((resolve) => {
    let outstanding = answers.length;
    if (outstanding === 0) {
      resolve(null);
      return;
    }
    function settle(value: HoldAsked | null): void {
      if (value !== null) {
        resolve(value);
        return;
      }
      outstanding -= 1;
      if (outstanding === 0) resolve(null);
    }
    for (const answer of answers) {
      void answer.then(settle, () => settle(null));
    }
  });
}

export interface HoldForInput {
  home: string;
  /** Only when a person could actually see it. A headless box has nobody at /dev/tty. */
  interactive: boolean;
  announce?: (message: string) => void;
  timeoutMs?: number;
  /** What the session did before it asked. The ledger on this machine unless replaced. */
  work?: WorkReader;
  /** Whether a question nobody answered is kept for later. On unless a caller turns it off. */
  park?: boolean;
}

/** Somebody to ask, composed here because the shell wrapper and the MCP proxy both need it. */
export function holdFor(deps: HoldForInput): HoldService {
  return new HoldService(
    new WorkEvidencePrompt(
      new RoutedHoldPrompt({
        approvals: new PendingApprovals(deps.home),
        route: () => readApprovalRoute(deps.home),
        ...(deps.interactive ? { tty: new TtyHoldPrompt() } : {}),
        ...(deps.announce === undefined ? {} : { announce: deps.announce }),
        ...(deps.park === false ? {} : { parkMs: PARKED_HOURS * HOUR_MS }),
      }),
      deps.work ?? ledgerWork(deps.home),
    ),
    // Somebody elsewhere has to be found and their answer travel back, so they get longer.
    deps.timeoutMs ??
      (deps.interactive ? DEFAULT_HOLD_TIMEOUT_MS : DEFAULT_UNATTENDED_HOLD_TIMEOUT_MS),
    // On disk, because the process that heard the answer is rarely the one asked next.
    new FileGrants(deps.home),
  );
}
