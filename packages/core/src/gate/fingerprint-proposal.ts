import { parse, stringify } from 'yaml';

import { matchesAny } from '../policy/pattern-matcher';
import {
  fingerprintPolicies,
  MOST_GUIDANCE_LINES,
  parseCodeFingerprint,
  type CodeFingerprint,
} from './code-fingerprint';
import { slashed } from '../domain/separators';

/**
 * What the agent working in a repository is asked, once, so the fingerprint is read out
 * of the code by the model the person already runs and Memnox needs none of its own. Any
 * language and any framework: the agent names what it finds.
 */
export const FINGERPRINT_PROMPT = [
  'Read this repository closely enough to write its code fingerprint: the page an agent who has never seen this code reads before changing it, and the checks a machine runs on every line an agent writes. Then call the memnox-session "fingerprint" tool with it as `yaml`. Every agent after you is held to it and only a person changes it later, so take the time to get it right.',
  '',
  'How to read: start from the README and the build files, walk the directory layout, then open at least two files of every kind (entry points, handlers, business logic, data access, models, configuration, jobs, migrations, tests). Before you state a convention, search the code to see how often it is followed. State only what most of the code already does, never what you would prefer, and name the exception where there is one.',
  '',
  'What to write: top level sections of your own naming, as short values or lists, such as `files: kebab-case` or `avoid: [deeply nested conditionals]`. Cover each of these that applies and skip the rest:',
  '  stack: languages and versions, frameworks, key libraries, the build tool',
  '  layout: where each kind of file lives, and which folders are generated or vendored and never edited by hand',
  '  architecture: the layers, which may call which, and where writes, side effects and external calls happen',
  '  recipe: the steps to add a typical feature end to end, in order, naming the files each step touches',
  '  naming: files, types, functions, variables, tests, database objects',
  '  style: formatting, imports, immutability, how data types are declared and built',
  '  errors: how failures are raised, wrapped and reported, and the message format',
  '  data: absence and nulls, time and time zones, money and numbers, ids',
  '  logging: the logger, how it is named and how it is called',
  '  configuration: where settings come from, and how secrets stay out of the code',
  '  dependencies: how one is added, and what is deliberately not used',
  '  testing: frameworks, where tests live, naming, structure, fixtures, what is mocked and what is real',
  '  commands: how to build, test, format and regenerate code',
  '  comments: when and how',
  `Where a section has one, add an \`example:\` path to the file that shows it best. Keep to ${MOST_GUIDANCE_LINES} lines of guidance at most, each under 200 characters, because what is past that is not read.`,
  '',
  'Then an `enforce` list: checks a machine runs on every line an agent adds. Each entry:',
  '  name: a short kebab case id',
  '  files: globs relative to the repository root; a leading ! takes files back out',
  '  forbid: patterns an added line must not match. `*` is the only wildcard and matches anything, matching is case insensitive and covers the whole line, so write `*console.log(*` rather than `console.log(`. No regular expressions.',
  '  reason: the convention, in one line',
  '  instead: what to write instead, in one line',
  '',
  'Aim for 8 to 15 checks, spent where an agent is most likely to go wrong here:',
  '  1. the architecture: a call that crosses a layer it must not, such as data access from a handler, or a write outside the one place writes belong',
  '  2. the data rules: the wrong clock or time zone, a null where the code uses an optional, floating point for money, a hand built id',
  '  3. errors and logging: printing instead of logging, the wrong exception at a boundary',
  '  4. testing: the wrong test framework or assertion library in test files',
  '  5. anything else most of the code avoids that an agent would plausibly write',
  'Never spend a check on a library or annotation nothing here would use, because a check that can never fire protects nothing. Scope each one to the files it is about, and keep tests apart from main code where their rules differ.',
  '',
  'Make every pattern exact, because it matches any line containing it: `*@Inject*` also refuses `@InjectMocks`, so write `*import javax.inject*`. Search the code for each pattern before you submit it. A check that matches code the repository already has is dropped, and so is one whose files are only vendored or ignored folders, which are not read. A rule that no single line can show, such as never editing generated code or keeping functions short, belongs in the guidance instead.',
  '',
  'The tool answers with what it kept, what it dropped and why. Tell the person that, and that the file is theirs to review and commit.',
].join('\n');

/** How much of an agent's answer is read, since a fingerprint is a page and never a book. */
export const MOST_PROPOSAL_CHARS = 20_000;

const FENCE = /^```[a-z]*\s*$/i;

/**
 * The fingerprint an agent answered with, read the same way the gate reads the file, so
 * what is recorded is exactly what is enforced. Fences are taken off, since agents add
 * them however they are asked.
 */
export function proposalFrom(answer: string): {
  yaml: string;
  fingerprint: CodeFingerprint;
} {
  const yaml = answer
    .slice(0, MOST_PROPOSAL_CHARS)
    .split('\n')
    .filter((line) => !FENCE.test(line.trim()))
    .join('\n')
    .trim();
  return { yaml: `${yaml}\n`, fingerprint: parseCodeFingerprint(yaml) };
}

/** Whether an answer says anything at all, so an empty or refused one is never written. */
export function saysSomething(fingerprint: CodeFingerprint): boolean {
  return fingerprint.guidance.length > 0 || fingerprint.checks.length > 0;
}

/** One file of the repository as it stands, for testing a check against what is there. */
export interface ExistingFile {
  /** Absolute, as a write is ruled on. */
  path: string;
  lines: readonly string[];
}

/** A check the code already breaks, and where first, so the agent can narrow it. */
export interface BrokenCheck {
  name: string;
  lines: number;
  first: string;
}

/**
 * The checks existing code already breaks. Such a check does not describe the repository,
 * and enforcing it would refuse an agent for writing the way the code is written.
 */
export function checksBreakingExisting(
  fingerprint: CodeFingerprint,
  root: string,
  files: readonly ExistingFile[],
): BrokenCheck[] {
  const policies = fingerprintPolicies(fingerprint, root);
  const broken: BrokenCheck[] = [];
  for (const [index, check] of fingerprint.checks.entries()) {
    const policy = policies[index];
    if (policy === undefined) continue;
    const hits = files
      .filter((file) => matchesAny(policy.match.targets, file.path))
      .map((file) => ({
        file,
        count: file.lines.filter((line) => matchesAny(policy.match.content, line)).length,
      }))
      .filter((each) => each.count > 0);
    const first = hits[0];
    if (first === undefined) continue;
    broken.push({
      name: check.name,
      lines: hits.reduce((sum, each) => sum + each.count, 0),
      // Named as the repository names it, so an agent on Windows reads the same path.
      first: slashed(first.file.path.slice(root.length + 1)),
    });
  }
  return broken;
}

/**
 * The checks whose files name nothing the repository has. Such a check describes code that
 * is not here, usually a guessed directory, and would only ever fire on code yet to come.
 */
export function checksCoveringNothing(
  fingerprint: CodeFingerprint,
  root: string,
  paths: readonly string[],
): string[] {
  const policies = fingerprintPolicies(fingerprint, root);
  return fingerprint.checks
    .filter((_check, index) => {
      const targets = policies[index]?.match.targets;
      return targets !== undefined && !paths.some((path) => matchesAny(targets, path));
    })
    .map((check) => check.name);
}

/** The paths at least one check covers, since a file no check names cannot break one. */
export function pathsChecked(
  fingerprint: CodeFingerprint,
  root: string,
  paths: readonly string[],
): string[] {
  const targets = fingerprintPolicies(fingerprint, root).map(
    (policy) => policy.match.targets,
  );
  return paths.filter((path) => targets.some((each) => matchesAny(each, path)));
}

/** The answer as written, with the dropped checks taken out and everything else kept. */
export function withoutChecks(yaml: string, dropped: ReadonlySet<string>): string {
  if (dropped.size === 0) return yaml;
  // Only called on an answer that already parsed as a mapping of sections.
  const document = parse(yaml) as Record<string, unknown>;
  const enforce = document['enforce'];
  if (Array.isArray(enforce)) {
    document['enforce'] = enforce.filter((entry: unknown) => !named(entry, dropped));
  }
  return stringify(document);
}

function named(entry: unknown, names: ReadonlySet<string>): boolean {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const name = Object.entries(entry).find(([key]) => key === 'name')?.[1];
  return typeof name === 'string' && names.has(name);
}
