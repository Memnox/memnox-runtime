import { DECISION_EFFECT } from '../constants/decision.constants';
import { changesExternalState } from '../discovery/classify';
import type { MemnoxEvent } from '../event/event';
import { didFail } from '../event/outcome';
import { redactSecrets } from '../domain/redact';
import {
  describeSpan,
  IN_SECONDS_THEN_MINUTES_THEN_HOURS,
} from '../domain/duration-text';
import { outcomesFrom } from './replay';
import { summarizeSession } from './session-summary';
import { strainOf } from './strain';
import { isTestCommand } from './watches';

/**
 * What the session did before it asked, so a person deciding whether work is ready reads
 * what the record says rather than what the agent claims: the last test run, what it
 * changed, and what failed and was got past. Every line is a fact from the ledger.
 */

/** Files named in the line, by name; the rest are counted. */
const FILES_NAMED = 3;
/** How much of a session's history a hold reads, since a person is waiting on it. */
export const WORK_EVIDENCE_LIMIT = 500;

export const TESTS_STANDING = {
  PASSED: 'passed',
  FAILED: 'failed',
  /** Passed, then files changed, so the pass no longer covers the work. */
  STALE: 'stale',
  NONE: 'none',
} as const;

export type TestsStanding = (typeof TESTS_STANDING)[keyof typeof TESTS_STANDING];

export interface WorkEvidence {
  tests: TestsStanding;
  /** The last test command, as typed. */
  testCommand?: string;
  testAt?: string;
  /** Files changed after the last test run, which is what makes a pass stale. */
  changedSinceTests: number;
  filesChanged: string[];
  /** Changes that ran outside this machine, by system. */
  outside: { name: string; changes: number }[];
  recovered: number;
  failing: string[];
}

/** The command a row stands for, in the words somebody would type: `npm.test` is `npm test`. */
function commandLine(event: MemnoxEvent): string {
  if (event.operation.startsWith('shell.')) return event.target ?? '';
  const [tool = '', ...verb] = event.operation.split('.');
  const words = verb.join(' ');
  const target = event.target === undefined ? '' : ` ${event.target}`;
  return words === 'unknown' || words === ''
    ? `${tool}${target}`
    : `${tool} ${words}${target}`;
}

function ran(event: MemnoxEvent): boolean {
  return event.effect === DECISION_EFFECT.ALLOW;
}

function isFileChange(event: MemnoxEvent): boolean {
  const namespace = event.operation.split('.')[0] ?? '';
  return (
    (namespace === 'file' || namespace === 'filesystem') &&
    event.target !== undefined &&
    changesExternalState(event.class)
  );
}

export function workEvidenceOf(events: readonly MemnoxEvent[]): WorkEvidence {
  const ordered = [...events].filter(ran).sort((a, b) => a.at.localeCompare(b.at));
  const tests = ordered.filter((event) => isTestCommand(commandLine(event)));
  const lastTest = tests.at(-1);
  const changes = ordered.filter(isFileChange);
  const changedSinceTests =
    lastTest === undefined
      ? 0
      : new Set(
          changes.filter((event) => event.at > lastTest.at).map((event) => event.target),
        ).size;
  const strain = strainOf(outcomesFrom(ordered));
  const summary = summarizeSession(ordered);
  return {
    tests: standingOf(lastTest, changedSinceTests),
    ...(lastTest === undefined
      ? {}
      : { testCommand: commandLine(lastTest), testAt: lastTest.at }),
    changedSinceTests,
    filesChanged: [...new Set(changes.map((event) => event.target ?? ''))],
    outside:
      summary === null
        ? []
        : summary.systems
            .filter((system) => system.changes > 0)
            .map((system) => ({ name: system.name, changes: system.changes })),
    recovered: strain.recovered,
    failing: strain.failing,
  };
}

function standingOf(
  lastTest: MemnoxEvent | undefined,
  changedSince: number,
): TestsStanding {
  if (lastTest === undefined) return TESTS_STANDING.NONE;
  if (didFail(lastTest)) return TESTS_STANDING.FAILED;
  return changedSince > 0 ? TESTS_STANDING.STALE : TESTS_STANDING.PASSED;
}

/** One line per fact, in the order a person asks them: does it work, what did it touch. */
export function describeWorkEvidence(work: WorkEvidence, now: string): string[] {
  // Command lines can carry a token, and these lines reach a terminal and a phone.
  return [
    testsLine(work, now),
    changedLine(work),
    outsideLine(work),
    ...troubleLines(work),
  ].map(redactSecrets);
}

function testsLine(work: WorkEvidence, now: string): string {
  const command = work.testCommand ?? '';
  const when = work.testAt === undefined ? '' : ` ${ago(work.testAt, now)}`;
  switch (work.tests) {
    case TESTS_STANDING.PASSED:
      return `tests: ${command} passed${when}, and nothing changed since`;
    case TESTS_STANDING.FAILED:
      return `tests: ${command} failed${when}`;
    case TESTS_STANDING.STALE:
      return `tests: ${command} passed${when}, but ${work.changedSinceTests} file(s) changed after it`;
    default:
      return 'tests: none run in this session';
  }
}

function changedLine(work: WorkEvidence): string {
  const files = work.filesChanged;
  if (files.length === 0) return 'changed: no files';
  const named = files.slice(0, FILES_NAMED).join(', ');
  const more = files.length - FILES_NAMED;
  return `changed: ${files.length} file(s), ${named}${more > 0 ? ` and ${more} more` : ''}`;
}

function outsideLine(work: WorkEvidence): string {
  if (work.outside.length === 0)
    return 'outside: nothing changed outside this machine yet';
  const each = work.outside.map((system) => `${system.name} ${system.changes}`);
  return `outside: changes in ${each.join(', ')}`;
}

function troubleLines(work: WorkEvidence): string[] {
  return [
    ...(work.recovered > 0
      ? [`recovered: ${work.recovered} failure(s) later got past`]
      : []),
    ...(work.failing.length > 0 ? [`failing: ${work.failing.join(', ')}`] : []),
  ];
}

function ago(at: string, now: string): string {
  const span = Math.max(0, Date.parse(now) - Date.parse(at));
  return `${describeSpan(span, IN_SECONDS_THEN_MINUTES_THEN_HOURS)} ago`;
}
