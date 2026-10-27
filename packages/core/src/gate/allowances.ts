/**
 * A scope a person allowed for a while: "Claude may change staging payments-api for thirty
 * minutes". It turns an ask inside the scope into an allow, never a refusal, and it ends
 * on its own, so debugging access never quietly becomes standing authority.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import type { ActionRequest } from '../domain/action-event';
import { matchesAny } from '../policy/pattern-matcher';
import { readJsonArray, writeJsonFile } from '../store/json-records';

const ALLOWANCES_FILE = 'allowances.json';

/** What the autopilot granted, kept apart so `memnox allow` never writes or caps it. */
export const EARNED_ALLOWANCES_FILE = 'earned-allowances.json';

/** The longest an allowance may stand, so one somebody forgot still ends the same day. */
export const MOST_ALLOWANCE_MINUTES = 8 * 60;

export interface Allowance {
  id: string;
  /** Action patterns, as a rule's `actions` are written. */
  actions: string[];
  environments?: string[];
  targets?: string[];
  agents?: string[];
  /** Who allowed it and why, carried into every decision it made. */
  by: string;
  reason?: string;
  since: string;
  until: string;
  revokedAt?: string;
}

export function inForceAt(allowance: Allowance, now: string): boolean {
  return (
    allowance.revokedAt === undefined && allowance.until > now && allowance.since <= now
  );
}

/** The allowance covering this request, if any. Every field it names must match. */
export function allowanceFor(
  allowances: readonly Allowance[],
  request: ActionRequest,
  context: { agentName: string; now: string },
): Allowance | null {
  return (
    allowances.find(
      (each) =>
        inForceAt(each, context.now) &&
        matchesAny(each.actions, request.action) &&
        matchesAny(each.environments, request.environment) &&
        matchesAny(each.targets, request.target) &&
        matchesAny(each.agents, context.agentName),
    ) ?? null
  );
}

/** How a decision an allowance made reads, so `why` names who allowed it and until when. */
export function describeAllowance(allowance: Allowance): string {
  const why = allowance.reason === undefined ? '' : ` (${allowance.reason})`;
  return `${allowance.by} allowed this until ${allowance.until}${why}, allowance ${allowance.id}`;
}

/** The records in one allowances file, ended ones included, and the way back to it. */
class AllowanceFile {
  constructor(
    private readonly home: string,
    private readonly file: string,
  ) {}

  all(): Promise<Allowance[]> {
    return readJsonArray<Allowance>(this.path());
  }

  /** Ended ones are kept a day for the record, then dropped, so the file stays small. */
  async add(allowance: Allowance): Promise<void> {
    const dayAgo = new Date(
      Date.parse(allowance.since) - 24 * 60 * 60 * 1_000,
    ).toISOString();
    const kept = (await this.all()).filter((each) => each.until > dayAgo);
    await writeJsonFile(this.path(), [...kept, allowance]);
  }

  /** Null when there was no such allowance. */
  async revoke(id: string, now: string): Promise<Allowance | null> {
    const all = await this.all();
    const found = all.find((each) => each.id === id);
    if (found === undefined) return null;
    const revoked = { ...found, revokedAt: found.revokedAt ?? now };
    await writeJsonFile(
      this.path(),
      all.map((each) => (each === found ? revoked : each)),
    );
    return revoked;
  }

  /** For a gate that decides synchronously; a file that will not read is no allowance. */
  inForceNow(now: string): Allowance[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path(), 'utf8'));
      if (!Array.isArray(parsed)) return [];
      // Written by `add` above, so each entry is an allowance.
      return (parsed as Allowance[]).filter((each) => inForceAt(each, now));
    } catch {
      return [];
    }
  }

  private path(): string {
    return join(this.home, MEMNOX_HOME, this.file);
  }
}

/**
 * What a person allowed with `memnox allow`, and what the gate reads: those together with
 * what the autopilot granted, since both turn an ask into an allow the same way.
 */
export class FileAllowances {
  private readonly given: AllowanceFile;
  private readonly earned: EarnedAllowances;

  constructor(home: string) {
    this.given = new AllowanceFile(home, ALLOWANCES_FILE);
    this.earned = new EarnedAllowances(home);
  }

  all(): Promise<Allowance[]> {
    return this.given.all();
  }

  async inForce(now: string): Promise<Allowance[]> {
    const given = (await this.given.all()).filter((each) => inForceAt(each, now));
    return [...given, ...(await this.earned.inForce(now))];
  }

  add(allowance: Allowance): Promise<void> {
    return this.given.add(allowance);
  }

  /** Ends one a person gave, or one the autopilot granted, whichever holds the id. */
  async revoke(id: string, now: string): Promise<Allowance | null> {
    return (await this.given.revoke(id, now)) ?? this.earned.revoke(id, now);
  }

  inForceNow(now: string): Allowance[] {
    return [...this.given.inForceNow(now), ...this.earned.inForceNow(now)];
  }
}

/** The autopilot's grants: written only by the daemon, read by every gate beside the rest. */
export class EarnedAllowances {
  private readonly file: AllowanceFile;

  constructor(home: string) {
    this.file = new AllowanceFile(home, EARNED_ALLOWANCES_FILE);
  }

  all(): Promise<Allowance[]> {
    return this.file.all();
  }

  async inForce(now: string): Promise<Allowance[]> {
    return (await this.file.all()).filter((each) => inForceAt(each, now));
  }

  add(allowance: Allowance): Promise<void> {
    return this.file.add(allowance);
  }

  revoke(id: string, now: string): Promise<Allowance | null> {
    return this.file.revoke(id, now);
  }

  inForceNow(now: string): Allowance[] {
    return this.file.inForceNow(now);
  }
}
