import {
  LEASE_MAX_WAIT_MS,
  describeLease,
  waitFor,
  type Lease,
  type LeaseHolder,
  type LeaseRequest,
} from './lease';
import { LEASE_OUTCOME, type LeaseRegistry } from './lease-store';
import { shortMachine } from './shared-actions';
import { SHARED_OUTCOME, type SharedLeases, type SharedTake } from './shared-leases';
import type { WrittenRegion } from './written-region';
import { minutesToMs, msToWholeMinutes } from '../domain/time';

/**
 * What happens when somebody else already holds the path a write needs. Every wait is
 * bounded, every refusal names the holder, and taking it anyway is a row.
 */

export const LEASE_ANSWER = {
  /** Wait for the holder, bounded. */
  WAIT: 'wait',
  /** Take it anyway, with a reason. Recorded, never silent. */
  TAKE: 'take',
  REFUSE: 'refuse',
} as const;

export type LeaseAnswer = (typeof LEASE_ANSWER)[keyof typeof LEASE_ANSWER];

export interface LeaseAsked {
  answer: LeaseAnswer;
  /** Required for `TAKE`: an override with no reason is a slower allow. */
  reason?: string;
}

/** Where the question is asked. Injected, so nothing here needs a terminal. */
export interface LeasePrompt {
  /** Null when there is nobody to ask, meaning no TTY or an unattended run. */
  ask(
    held: Lease,
    wanted: string,
    moment: string,
    waitMs: number,
    /** The asker's checkout, so a holder in another worktree is named by where it is. */
    from?: string,
  ): Promise<LeaseAsked | null>;
}

export const LEASE_GATE = {
  /** Nobody was in the way, or the holder was this same session. */
  TAKEN: 'taken',
  /** Somebody was, and they let go inside the window. */
  WAITED: 'waited',
  /** Somebody was, and it was taken from them on the record. */
  TOOK_OVER: 'took-over',
  /** Somebody was, and the writer stood down. */
  REFUSED: 'refused',
  /** Somebody was, nobody could be asked, and the wait ran out. Names the holder. */
  TIMED_OUT: 'timed-out',
} as const;

export type LeaseGateOutcome = (typeof LEASE_GATE)[keyof typeof LEASE_GATE];

export interface LeaseVerdict {
  outcome: LeaseGateOutcome;
  lease?: Lease;
  /** The lease that was in the way, so a refusal can name who to go and ask. */
  holding?: Lease;
  /** What to print. A refusal that explains nothing gets the wrapper removed. */
  message?: string;
  /** The workspace lease in the way, so the person at the refused agent can take it over. */
  sharedLeaseId?: string;
  /** The refusal without the command to type, for a host that asks its person itself. */
  asked?: string;
  /**
   * Said when the write goes ahead but the workspace could not be asked, so nobody is told a
   * collision with another machine was ruled out when it was not.
   */
  unconfirmed?: string;
}

export function proceeds(verdict: LeaseVerdict): boolean {
  return (
    verdict.outcome === LEASE_GATE.TAKEN ||
    verdict.outcome === LEASE_GATE.WAITED ||
    verdict.outcome === LEASE_GATE.TOOK_OVER
  );
}

export interface LeaseGateDeps {
  registry: LeaseRegistry;
  /** The workspace register, consulted after the local one, which is cheaper and more often right. */
  shared?: SharedLeases;
  prompt?: LeasePrompt;
  /** What in the file this write touches, absent for the whole file. Asked only after the local register agrees. */
  region?: (path: string) => Promise<WrittenRegion>;
  /** The checkout this gate claims in, so one machine's register keeps its repositories apart. */
  repository?: string;
  /** What every checkout of this repository shares, so two worktrees of it meet. */
  project?: string;
  /** The clock, injected so a replay gives the same answer twice. */
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** How long a wait may run at most, whatever the lease says. */
  ceilingMs?: number;
  /** How often this machine's register is asked again while a local holder writes. */
  pollMs?: number;
  /** How soon the workspace is first asked again, doubling to a ceiling, so a crowd does not hammer it. */
  sharedPollMs?: number;
}

/** Short, since a release is a file going away and the waiter should notice it at once. */
const DEFAULT_POLL_MS = 150;
const DEFAULT_SHARED_POLL_MS = 250;
const SLOWEST_SHARED_POLL_MS = 2_000;
/** Matches the local default, so one window is not quietly longer than the other. */
const DEFAULT_SHARED_MINUTES = 30;

type HeldElsewhere = Extract<
  SharedTake,
  { outcome: typeof SHARED_OUTCOME.HELD_BY_ANOTHER }
>;

/** Names the lines and function where git could tell, so the agent works on the rest. */
function heldElsewhere(result: HeldElsewhere, now: string): string {
  const where = result.machine === undefined ? '' : ` on ${shortMachine(result.machine)}`;
  const path = result.path === '' ? 'this repository' : result.path;
  const part = describeRegion(result.region);
  const held =
    part === null
      ? `${result.holder}${where} is writing ${path}.`
      : `${result.holder}${where} is editing ${part} of ${path}. The rest of the file is free.`;
  // Named for a person, since the command asks on a terminal and the agent cannot run it on itself.
  const free =
    result.leaseId === undefined
      ? ''
      : ` A person can free them now by running \`memnox lock --free ${result.leaseId}\`.`;
  // Agents settle it between themselves first, so a person is only brought in when they must be.
  const ask =
    result.leaseId === undefined
      ? ''
      : ` Ask it directly with memnox_message_agent, lease "${result.leaseId}".`;
  return `${held}${quiet(result, now)}${ask}${free}`;
}

/** The same answer with no lease to name, so no command to free it is offered. */
function withoutLease(result: HeldElsewhere): HeldElsewhere {
  const { leaseId: _named, ...rest } = result;
  return rest;
}

/** How long a holder has done nothing before a refusal says so. */
const QUIET_AFTER_MS = minutesToMs(2);

/** Says the holder has gone quiet and when its hold lapses, so the waiter comes back rather than gives up. */
function quiet(result: { lastActive?: string; until?: string }, now: string): string {
  if (result.lastActive === undefined) return '';
  const idle = Date.parse(now) - Date.parse(result.lastActive);
  if (!Number.isFinite(idle) || idle < QUIET_AFTER_MS) return '';
  const minutes = msToWholeMinutes(idle);
  const lapse =
    result.until === undefined ? '' : `, so they free up at ${clock(result.until)}`;
  return ` It has been quiet for ${minutes} minutes${lapse} unless it comes back.`;
}

/** `14:40 UTC`, which is what a person and a model both read at a glance. */
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(11, 16)} UTC`;
}

/** `retryCharge (lines 7 to 12)`, or null where nothing narrower than the file is known. */
function describeRegion(region: WrittenRegion | undefined): string | null {
  if (region === undefined) return null;
  const spans = region.lines.map((each) =>
    each.from === each.to ? `line ${each.from}` : `lines ${each.from} to ${each.to}`,
  );
  const names = region.symbols;
  if (names.length === 0 && spans.length === 0) return null;
  if (names.length === 0) return spans.join(', ');
  const named = names.join(', ');
  return spans.length === 0 ? named : `${named} (${spans.join(', ')})`;
}

/** A claim in flight: what the writer asked for, and the lease in its way. */
interface HeldClaim {
  request: LeaseRequest;
  holding: Lease;
}

/** Another machine's hold as a refusal, and when it lapses where the workspace said. */
interface SharedHeld {
  verdict: LeaseVerdict;
  until?: number;
}

/** The workspace's answer: in the way, unconfirmed, or neither, which is free. */
interface SharedAsked {
  held?: SharedHeld;
  unconfirmed?: string;
}

/** Plain, because the agent goes ahead and must not read the silence as safety. */
function unconfirmedFor(path: string, because: string): string {
  return `Could not check whether another machine is writing ${path}, because ${because}. The write went ahead, but a collision with another machine was not ruled out.`;
}

export class LeaseGate {
  constructor(private readonly deps: LeaseGateDeps) {}

  /**
   * Takes the path, or answers with what to do about the agent already on it. Reads never
   * reach here, because `takesLease` decides before this is called.
   */
  async claim(
    path: string,
    holder: LeaseHolder,
    activity: string,
    minutes?: number,
  ): Promise<LeaseVerdict> {
    // Read once, before either register, so this machine and the workspace compare the same code.
    const region = await this.regionOf(path);
    const request: LeaseRequest = {
      path,
      holder,
      activity,
      minutes,
      ...(region === undefined ? {} : { region }),
      ...(this.deps.repository === undefined ? {} : { repository: this.deps.repository }),
      ...(this.deps.project === undefined ? {} : { project: this.deps.project }),
    };
    const ceiling = this.deps.ceilingMs ?? LEASE_MAX_WAIT_MS;
    // One window for both registers, so waiting here and then on another machine is never twice it.
    const deadline = this.deadlineIn(ceiling);
    const first = await this.deps.registry.take(request, this.deps.now());
    if (first.outcome === LEASE_OUTCOME.TAKEN)
      return this.confirmShared(request, first.lease, deadline, false);
    // A path this cannot reason about gets no invented lease, and refusing would block work over a spelling.
    if (first.outcome === LEASE_OUTCOME.UNUSABLE_PATH)
      return { outcome: LEASE_GATE.TAKEN };

    const held: HeldClaim = { request, holding: first.holding };
    const budget = waitFor(held.holding, this.deps.now(), ceiling);
    const asked = await this.ask(held.holding, path, budget);
    if (asked === null || asked.answer === LEASE_ANSWER.WAIT)
      return this.waitOut(held, budget, deadline);
    if (asked.answer === LEASE_ANSWER.TAKE)
      return this.takeOver(held, asked.reason ?? '');
    return {
      outcome: LEASE_GATE.REFUSED,
      holding: held.holding,
      message: `Stood down: ${describeLease(held.holding, this.deps.now(), this.deps.repository)}`,
    };
  }

  private deadlineIn(ms: number): number {
    return Date.parse(this.deps.now()) + ms;
  }

  /**
   * Another machine holding it means the local lease goes straight back, or the register
   * goes stale, and the writer waits for that machine as it would for one here.
   */
  private async confirmShared(
    request: LeaseRequest,
    lease: Lease,
    deadline: number,
    waited: boolean,
  ): Promise<LeaseVerdict> {
    const asked = await this.claimShared(request);
    if (asked.held === undefined) {
      return {
        outcome: waited ? LEASE_GATE.WAITED : LEASE_GATE.TAKEN,
        lease,
        ...(asked.unconfirmed === undefined ? {} : { unconfirmed: asked.unconfirmed }),
      };
    }
    await this.deps.registry.release(lease.id, request.holder, this.deps.now());
    return this.waitShared(request, asked.held, deadline);
  }

  /**
   * Polls the workspace with a doubling pause until the other machine lets go, bounded by
   * the deadline, by when its lease lapses, and by a count, as the local wait is.
   */
  private async waitShared(
    request: LeaseRequest,
    held: SharedHeld,
    deadline: number,
  ): Promise<LeaseVerdict> {
    const end = Math.min(deadline, held.until ?? deadline);
    const budget = end - Date.parse(this.deps.now());
    if (budget <= 0) return held.verdict;
    let poll = this.deps.sharedPollMs ?? DEFAULT_SHARED_POLL_MS;
    const attempts = Math.max(1, Math.ceil(budget / poll));
    let last = held.verdict;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const left = end - Date.parse(this.deps.now());
      if (left <= 0) break;
      await this.sleep(Math.min(poll, left));
      poll = Math.min(poll * 2, SLOWEST_SHARED_POLL_MS);
      // This machine's register first, so a local holder that arrived meanwhile is not trampled.
      const local = await this.deps.registry.take(request, this.deps.now());
      if (local.outcome !== LEASE_OUTCOME.TAKEN) continue;
      const asked = await this.claimShared(request);
      if (asked.held === undefined) {
        return {
          outcome: LEASE_GATE.WAITED,
          lease: local.lease,
          ...(asked.unconfirmed === undefined ? {} : { unconfirmed: asked.unconfirmed }),
        };
      }
      await this.deps.registry.release(local.lease.id, request.holder, this.deps.now());
      last = asked.held.verdict;
    }
    return { ...last, outcome: LEASE_GATE.TIMED_OUT };
  }

  /**
   * What the workspace said. Not knowing lets the write through, since a lease is
   * coordination and not safety, but where it went unanswered the writer is told so.
   */
  private async claimShared(request: LeaseRequest): Promise<SharedAsked> {
    const shared = this.deps.shared;
    if (shared === undefined) return {};
    const result = await shared
      .take(
        request.path,
        request.holder,
        request.minutes ?? DEFAULT_SHARED_MINUTES,
        request.region,
      )
      .catch((): SharedTake => ({
        outcome: SHARED_OUTCOME.UNKNOWN,
        because: 'asking the control plane failed',
        unanswered: true,
      }));
    if (result.outcome === SHARED_OUTCOME.UNKNOWN) {
      return result.unanswered === true
        ? { unconfirmed: unconfirmedFor(request.path, result.because) }
        : {};
    }
    if (result.outcome !== SHARED_OUTCOME.HELD_BY_ANOTHER) return {};
    const until = result.until === undefined ? NaN : Date.parse(result.until);
    return {
      held: {
        verdict: {
          outcome: LEASE_GATE.REFUSED,
          message: heldElsewhere(result, this.deps.now()),
          asked: heldElsewhere(withoutLease(result), this.deps.now()),
          ...(result.leaseId === undefined ? {} : { sharedLeaseId: result.leaseId }),
        },
        ...(Number.isFinite(until) ? { until } : {}),
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    const sleep =
      this.deps.sleep ??
      ((wait: number) => new Promise<void>((resolve) => setTimeout(resolve, wait)));
    return sleep(ms);
  }

  /** Never throws and never blocks the write: unknown is the whole file. */
  private async regionOf(path: string): Promise<WrittenRegion | undefined> {
    const read = this.deps.region;
    if (read === undefined) return undefined;
    try {
      return await read(path);
    } catch {
      return undefined;
    }
  }

  private async ask(
    holding: Lease,
    path: string,
    budget: number,
  ): Promise<LeaseAsked | null> {
    if (this.deps.prompt === undefined) return null;
    try {
      return await this.deps.prompt.ask(
        holding,
        path,
        this.deps.now(),
        budget,
        this.deps.repository,
      );
    } catch {
      // A prompt that threw is a prompt nobody saw; wait it out rather than guessing.
      return null;
    }
  }

  /**
   * Bounded by the deadline and by a count, so a clock that does not advance cannot
   * turn the wait into a hang, which would be worse than the collision.
   */
  private async waitOut(
    held: HeldClaim,
    budget: number,
    window: number,
  ): Promise<LeaseVerdict> {
    const poll = this.deps.pollMs ?? DEFAULT_POLL_MS;
    const deadline = this.deadlineIn(budget);
    const attempts = Math.max(1, Math.ceil(budget / poll));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (Date.parse(this.deps.now()) >= deadline) break;
      await this.sleep(poll);
      const retry = await this.deps.registry.take(held.request, this.deps.now());
      if (retry.outcome === LEASE_OUTCOME.TAKEN) {
        // Free here is not free everywhere: the rest of the same window goes on the workspace.
        return this.confirmShared(held.request, retry.lease, window, true);
      }
    }

    return {
      outcome: LEASE_GATE.TIMED_OUT,
      holding: held.holding,
      message: `${describeLease(held.holding, this.deps.now(), this.deps.repository)} and did not let go. Wait, or take it with "memnox lock ${held.request.path}".`,
    };
  }

  private async takeOver(held: HeldClaim, reason: string): Promise<LeaseVerdict> {
    const { request, holding } = held;
    if (reason.trim() === '') {
      // An override nobody can explain is not an override.
      return {
        outcome: LEASE_GATE.REFUSED,
        holding,
        message: 'Taking a held path needs a reason, so the record says why.',
      };
    }
    await this.deps.registry.takeOver(
      holding.id,
      request.holder,
      reason,
      this.deps.now(),
    );
    const mine = await this.deps.registry.take(request, this.deps.now());
    return {
      outcome: LEASE_GATE.TOOK_OVER,
      holding,
      ...(mine.outcome === LEASE_OUTCOME.TAKEN ? { lease: mine.lease } : {}),
      message: `Took ${holding.path} from ${holding.holder.agent}: ${reason}`,
    };
  }
}
