import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import {
  describeRevisionChange,
  FileRevisions,
  REVISION_KIND,
  revisionChange,
  type Revision,
  type RevisionKind,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import { TONE } from '../flow';
import { positiveInteger } from '../positive-integer';

/**
 * `memnox policy history` and `memnox policy revert`: every change to the rules and to what the
 * autopilot granted, named, and a way back from any of them. A revert keeps what stood first, so
 * it is itself one more step that can be undone.
 */

interface HistoryDeps {
  home: () => string;
  now: () => Date;
}

interface HistoryOptions {
  allowances?: boolean;
  json?: boolean;
}

export function registerPolicyHistory(
  policy: Command,
  context: CliContext,
  deps: HistoryDeps,
): void {
  policy
    .command('history')
    .description('Every change to the rules, newest first, and what each one did')
    .option('--allowances', 'what the autopilot granted and took back, instead of rules')
    .option('--json', 'machine-readable output')
    .action(async (options: HistoryOptions) => runHistory(context, deps, options));

  policy
    .command('revert <n>')
    .description('Put the rules back as they were before change n')
    .action(async (n: string) => runRevert(context, deps, positiveInteger(n, '<n>')));
}

interface HistoryRow {
  revision: Revision;
  change: string;
}

async function runHistory(
  context: CliContext,
  deps: HistoryDeps,
  options: HistoryOptions,
): Promise<void> {
  const kind =
    options.allowances === true ? REVISION_KIND.ALLOWANCES : REVISION_KIND.RULES;
  const rows = await readHistory(deps.home(), kind);
  if (options.json === true) {
    context.out.json(
      rows.map(({ revision, change }) => ({
        n: revision.n,
        file: revision.file,
        at: revision.at,
        change,
      })),
    );
    return;
  }
  renderHistory(context, kind, rows);
}

/** Each kept change beside what it did, which is read against the copy that followed it. */
async function readHistory(home: string, kind: RevisionKind): Promise<HistoryRow[]> {
  const revisions = await new FileRevisions(home).list(kind);
  return Promise.all(
    revisions.map(async (revision, index) => ({
      revision,
      change: describeRevisionChange(
        revisionChange(revision, await afterOf(revision, revisions.slice(0, index))),
      ),
    })),
  );
}

function renderHistory(
  context: CliContext,
  kind: RevisionKind,
  rows: readonly HistoryRow[],
): void {
  const { flow } = context;
  flow.open('memnox policy history');
  if (rows.length === 0) {
    flow.close('Nothing has changed since history was kept.');
    return;
  }
  flow.list(
    kind === REVISION_KIND.RULES ? 'Rule changes' : 'Allowance changes',
    rows.map(({ revision, change }) => ({
      tone: TONE.PLAIN,
      text: `${revision.n}  ${revision.at.slice(0, 16).replace('T', ' ')}  ${revision.file}`,
      detail: [change],
    })),
  );
  flow.close(`${rows.length} change(s) kept.`);
  flow.hint('memnox policy revert <n>   puts a file back as it was before change n');
}

/** The next copy of the same file is what change n left; the newest change left the file as it is now. */
async function afterOf(revision: Revision, newer: readonly Revision[]): Promise<string> {
  const next = [...newer].reverse().find((each) => each.file === revision.file);
  if (next !== undefined) return next.content;
  return readFile(revision.file, 'utf8').catch(() => '');
}

async function runRevert(
  context: CliContext,
  deps: HistoryDeps,
  n: number,
): Promise<void> {
  const { flow, style } = context;
  flow.open('memnox policy revert');
  const reverted = await new FileRevisions(deps.home()).revert(
    n,
    deps.now().toISOString(),
  );
  if (reverted === null)
    throw new Error(`No change ${n} is kept. "memnox policy history" lists them.`);
  flow.rows('Put back', [
    { label: 'file', value: reverted.file },
    { label: 'as of', value: reverted.at },
  ]);
  flow.close(style.ok(`${reverted.file} is as it was before change ${n}.`));
  flow.hint('The revert is in the history too, so "memnox policy revert" can undo it.');
}
