import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import {
  describeHeldCall,
  HOLD_ANSWER,
  holdGrantSubject,
  type HoldAnswer,
  type HoldRequest,
} from './hold';
import type { PlainAsk } from './plain-ask';
import { FileGrants } from './session-grants';
import {
  describeSpan,
  IN_SECONDS_THEN_MINUTES_THEN_HOURS,
} from '../domain/duration-text';
import { JsonRecordDir } from '../store/json-records';

/**
 * A held call, written down so something other than its own terminal can answer it:
 * a second terminal locally, or the control plane. The waiting side does not know which.
 */

export const PENDING_DIR = 'pending';

export interface PendingApproval {
  id: string;
  request: HoldRequest;
  askedAt: string;
  /** When it stops being answerable. A hold with no end holds the agent for ever. */
  expiresAt: string;
  answer?: HoldAnswer;
  answeredAt?: string;
  /** Who answered, because "who approved this" is the first postmortem question. */
  answeredBy?: string;
  /** What the person said with a no, in their words, so the agent hears why and not only that. */
  answerReason?: string;
  /**
   * Where it may be answered: `session` stays on this machine, `both` reaches the
   * workspace too. Absent is every call raised before the field, which the workspace saw.
   */
  route?: 'session' | 'both';
  /** When the agent was told the answer, so it is told once. */
  toldAgentAt?: string;
  /** The question in a person's words, the same in the session and in their DM. */
  plain?: PlainAsk;
  /** When nobody answered in time and it was kept for later, rather than dropped. */
  parkedAt?: string;
  /** Where else it can be answered, which no picker on the agent's screen would ever hear of. */
  alsoOn?: AnswerPlace[];
}

/** A place beside the session that can answer a held call by itself. */
export const ANSWER_PLACE = {
  /** The Mac app, while it is listening. */
  MAC: 'mac',
  /** A paired phone, or a Mac reaching this one through the relay. */
  PAIRED: 'paired',
} as const;

export type AnswerPlace = (typeof ANSWER_PLACE)[keyof typeof ANSWER_PLACE];

/** How long a parked question waits for somebody who stepped away: a working day and a night. */
export const PARKED_HOURS = 16;

/** Whether the workspace is sent this call, so a person can answer it from chat. */
export function goesToWorkspace(pending: PendingApproval): boolean {
  return pending.route !== 'session';
}

export type AnswerOutcome =
  { answered: PendingApproval } | { alreadyAnswered: PendingApproval } | null;

export function pendingDirFor(home: string): string {
  return join(home, MEMNOX_HOME, PENDING_DIR);
}

export function pendingIdFor(request: HoldRequest, at: string): string {
  return `apr_${Date.parse(at).toString(36)}_${request.fingerprint.slice(0, 8)}`;
}

/** Beside each call's record, created only if absent, so of two answers at once exactly one is taken. */
const CLAIM_SUFFIX = '.claim';

export class PendingApprovals {
  private readonly records: JsonRecordDir<PendingApproval>;

  constructor(private readonly home: string) {
    this.records = new JsonRecordDir(pendingDirFor(home));
  }

  /** True for the one caller that gets to answer; false when another answer got there first. */
  private async claim(id: string): Promise<boolean> {
    const dir = pendingDirFor(this.home);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(join(dir, `${id}${CLAIM_SUFFIX}`), '', { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  async raise(
    request: HoldRequest,
    askedAt: string,
    timeoutMs: number,
    route?: PendingApproval['route'],
  ): Promise<PendingApproval> {
    const pending: PendingApproval = {
      id: pendingIdFor(request, askedAt),
      request,
      askedAt,
      expiresAt: new Date(Date.parse(askedAt) + timeoutMs).toISOString(),
      ...(route === undefined ? {} : { route }),
    };
    await this.records.write(pending.id, pending);
    return pending;
  }

  /** Rewrites a call already raised, as it is given. */
  keep(pending: PendingApproval): Promise<void> {
    return this.records.write(pending.id, pending);
  }

  /** Null when it was answered and cleared, or never raised. */
  read(id: string): Promise<PendingApproval | null> {
    return this.records.read(id);
  }

  async list(moment: string): Promise<PendingApproval[]> {
    const found = await this.records.all();
    return (
      found
        // An expired hold is not answerable, and showing it would invite answering it.
        .filter((pending) => pending.expiresAt > moment)
        .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
    );
  }

  /** First answer wins, and a second is told what already happened rather than failed. */
  async answer(
    id: string,
    answer: HoldAnswer,
    by: string,
    at: string,
    reason?: string,
  ): Promise<AnswerOutcome> {
    const pending = await this.read(id);
    if (pending === null) return null;
    if (pending.answer !== undefined) return { alreadyAnswered: pending };
    // The phone, the workspace and a second terminal can all answer within one poll of each other.
    if (!(await this.claim(id))) {
      const settled = await this.read(id);
      return settled === null ? null : { alreadyAnswered: settled };
    }

    const said = answer === HOLD_ANSWER.DENY ? answerReasonOf(reason) : undefined;
    const answered: PendingApproval = {
      ...pending,
      answer,
      answeredAt: at,
      answeredBy: by,
      ...(said === undefined ? {} : { answerReason: said }),
    };
    await this.records.write(id, answered);
    // Granted here, since an answer from a DM used to count only if the agent retried in time.
    if (answer === HOLD_ANSWER.SESSION)
      await new FileGrants(this.home).grant(holdGrantSubject(pending.request));
    // A second check on the same call reads this, since the first takes the question away.
    if (answer === HOLD_ANSWER.ONCE)
      await new FileGrants(this.home).allowOnce(
        holdGrantSubject(pending.request),
        pending.expiresAt,
      );
    return { answered };
  }

  /**
   * Kept for a person who is away, with a deadline long enough to come back to. Any parked
   * question already past its own deadline is removed here, since nothing else reads it.
   */
  async park(id: string, at: string, until: string): Promise<PendingApproval | null> {
    await this.forgetExpired(at);
    const pending = await this.read(id);
    if (pending === null) return null;
    const parked = { ...pending, parkedAt: at, expiresAt: until };
    await this.records.write(id, parked);
    return parked;
  }

  /** The parked question for this exact call in this session, answered or not, while in time. */
  async parkedFor(
    request: Pick<HoldRequest, 'sessionId' | 'fingerprint'>,
    moment: string,
  ): Promise<PendingApproval | null> {
    const found = await this.records.all();
    return (
      found.find(
        (each) =>
          each.parkedAt !== undefined &&
          each.expiresAt > moment &&
          each.request.sessionId === request.sessionId &&
          each.request.fingerprint === request.fingerprint,
      ) ?? null
    );
  }

  private async forgetExpired(moment: string): Promise<void> {
    for (const each of await this.records.all()) {
      if (each.parkedAt !== undefined && each.expiresAt <= moment)
        await this.clear(each.id);
    }
  }

  async clear(id: string): Promise<void> {
    await rm(join(pendingDirFor(this.home), `${id}${CLAIM_SUFFIX}`), { force: true });
    await this.records.remove(id);
  }
}

/** Often enough that an answer lands while somebody is still watching for it. */
const ANSWER_POLL_MS = 400;

export interface WaitForAnswerInput {
  approvals: PendingApprovals;
  id: string;
  /** Epoch milliseconds, on the same clock as `now`. */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls rather than watches, because the answer may come from another process, another
 * terminal or a sync client, and a file is the one thing all three agree on.
 */
export async function waitForAnswer(
  input: WaitForAnswerInput,
): Promise<HoldAnswer | null> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? sleepFor;
  while (now() < input.deadline) {
    const pending = await input.approvals.read(input.id);
    if (pending === null) return null;
    if (pending.answer !== undefined) return pending.answer;
    await sleep(input.intervalMs ?? ANSWER_POLL_MS);
  }
  return null;
}

export function describePending(pending: PendingApproval, moment: string): string {
  const waited = describeSpan(
    Math.max(0, Date.parse(moment) - Date.parse(pending.askedAt)),
    IN_SECONDS_THEN_MINUTES_THEN_HOURS,
  );
  const what = describeHeldCall(pending.request);
  // Parked is the agent carrying on without it, which is why it can wait this long.
  const parked = pending.parkedAt === undefined ? '' : ', parked while it works on';
  return `${pending.id}  ${pending.request.agent} wants to ${what}  (${waited} ago${parked})`;
}

/** Longer than a person types beside a no, and short enough that it cannot carry a whole instruction set. */
export const ANSWER_REASON_MAX = 200;

/** A person's reason as the agent may be told it: one line, trimmed, clipped. Undefined when nothing is left. */
export function answerReasonOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Control characters and line breaks out, so a reason reads as one sentence and never as a new turn.
  const line = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (line === '') return undefined;
  return line.length > ANSWER_REASON_MAX
    ? `${line.slice(0, ANSWER_REASON_MAX - 1)}…`
    : line;
}
