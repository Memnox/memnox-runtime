import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * Something the person asked to be told about a session, like "tell me when the tests pass".
 * Each watch speaks once and is gone, and the decision is made from facts the caller gathered,
 * so it is the same answer every time it is asked with the same facts.
 */

export const WATCHES_DIR = 'watches';

/** A working afternoon, never a watch that speaks up tomorrow about something long forgotten. */
export const WATCH_TTL_MS = 4 * 60 * 60 * 1_000;

export const WATCH_FOR = {
  /** Its turn ended and it handed back to the person. */
  FINISHED: 'finished',
  /** A test run passed after the watch was set. */
  TESTS_PASS: 'tests_pass',
  /** A test run failed after the watch was set. */
  TESTS_FAIL: 'tests_fail',
  /** It is paused, or a call of its is held waiting on the person. */
  STUCK: 'stuck',
} as const;

export type WatchFor = (typeof WATCH_FOR)[keyof typeof WATCH_FOR];

export interface SessionWatch {
  id: string;
  sessionId: string;
  agent: string;
  for: WatchFor;
  /** What the person said, so the voice can answer in their terms. */
  said?: string;
  /**
   * A session just started has no id until its agent first acts, so the watch waits for the
   * first one in this repository started after `since`, and `sessionId` stays empty until then.
   */
  awaiting?: AwaitedSession;
  setAt: string;
  expiresAt: string;
}

export interface AwaitedSession {
  repository: string;
  since: string;
}

/** One test run the agent made, as its own transcript records it. */
export interface TestRun {
  at: string;
  command: string;
  passed: boolean;
}

/** What is known about the session right now, gathered by whoever holds the files. */
export interface WatchFacts {
  promptAt?: string;
  endedAt?: string;
  testRuns: readonly TestRun[];
  paused: boolean;
  held: number;
}

/** Why it fired, in a plain sentence the voice can say when it cannot word it itself. */
export interface WatchFired {
  watch: SessionWatch;
  what: string;
}

/** Whether the thing the person asked about has happened since they asked, and what it was. */
export function watchFired(watch: SessionWatch, facts: WatchFacts): WatchFired | null {
  const since = (at: string | undefined): boolean => at !== undefined && at > watch.setAt;
  if (watch.for === WATCH_FOR.FINISHED) {
    const handedBack =
      since(facts.endedAt) &&
      (facts.promptAt === undefined || (facts.endedAt ?? '') >= facts.promptAt);
    return handedBack ? { watch, what: 'it finished its turn' } : null;
  }
  if (watch.for === WATCH_FOR.STUCK) {
    if (facts.paused) return { watch, what: 'it is paused' };
    return facts.held > 0
      ? { watch, what: 'it is waiting on you to answer a call' }
      : null;
  }
  const passing = watch.for === WATCH_FOR.TESTS_PASS;
  const run = [...facts.testRuns]
    .filter((each) => since(each.at) && each.passed === passing)
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  if (run === undefined) return null;
  return { watch, what: `${run.command} ${passing ? 'passed' : 'failed'}` };
}

/** Whether a shell command runs a test suite, from how test runners are invoked. */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

const TEST_COMMAND =
  /(^|[\s;&|(])((p?npm|yarn|bun)\s+(run\s+)?test\b|npx\s+(vitest|jest|playwright\s+test)\b|vitest\b|jest\b|pytest\b|go\s+test\b|cargo\s+test\b|swift\s+test\b|rspec\b|mix\s+test\b|phpunit\b)/;

export interface WatchInput {
  sessionId: string;
  agent: string;
  for: WatchFor;
  said?: string;
  awaiting?: AwaitedSession;
  at: string;
}

export class SessionWatches {
  private readonly records: JsonRecordDir<SessionWatch>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, WATCHES_DIR));
  }

  async set(input: WatchInput): Promise<SessionWatch> {
    const watch: SessionWatch = {
      id: `wch_${Date.parse(input.at).toString(36)}_${shortDigest(`${input.sessionId}${input.for}`)}`,
      sessionId: input.sessionId,
      agent: input.agent,
      for: input.for,
      ...(input.said === undefined ? {} : { said: input.said }),
      ...(input.awaiting === undefined ? {} : { awaiting: input.awaiting }),
      setAt: input.at,
      expiresAt: new Date(Date.parse(input.at) + WATCH_TTL_MS).toISOString(),
    };
    await this.records.write(watch.id, watch);
    return watch;
  }

  /** The watches still waiting, removing the expired so the folder never grows. */
  async open(moment: string): Promise<SessionWatch[]> {
    const found = await this.records.all();
    for (const each of found) {
      if (each.expiresAt <= moment) await this.records.remove(each.id);
    }
    return found.filter((each) => each.expiresAt > moment);
  }

  /** The session it was waiting for has appeared, so from now on it watches that one. */
  async bind(watch: SessionWatch, sessionId: string): Promise<SessionWatch> {
    const { awaiting: _done, ...rest } = watch;
    const bound = { ...rest, sessionId };
    await this.records.write(watch.id, bound);
    return bound;
  }

  /** Said once, so it is gone. */
  async done(id: string): Promise<void> {
    await this.records.remove(id);
  }
}
