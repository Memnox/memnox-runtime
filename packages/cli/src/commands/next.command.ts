import { homedir } from 'node:os';

import type { Command } from 'commander';

import { LEDGER_SCAN_LIMIT } from '@memnox/core';
import {
  delegations,
  describeLevel,
  ENFORCEMENT_MODE,
  handable,
  handOverVerdict,
  interruptions,
  weeksOfWork,
  type WeekOfWork,
  loadOrCreateConfig,
  LocalGate,
  promotable,
  standingOf,
  daysToMs,
  type AutonomyLevel,
  type Delegation,
  type MemnoxEvent,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import { TONE } from '../flow';
import { withEvents } from '../event-store';
import { since as windowStart } from '../duration';
import { policySetInForce } from '../policy-path';
import { runAllow } from '../protect/written-rules';
import {
  renderBoundary,
  wantsBoundary,
  type BoundaryOptions,
} from '../next/boundary-report';

/**
 * `memnox next`: what a person has already approved often enough that asking again
 * wastes their attention. Nothing here is a score, since every number counts an event.
 */

const DEFAULT_WINDOW_DAYS = 7;

/** The worst few interruptions, because a table nobody scrolls is one nobody finishes. */
const INTERRUPTIONS_SHOWN = 5;

/** Four weeks fit inside the default thirty day window, so every week shown was read whole. */
const WEEKS_SHOWN = 4;

type Interruptions = ReturnType<typeof interruptions>;

/** What the ledger says could be handed over, and where this machine stands. */
interface Delegable {
  standing: AutonomyLevel;
  found: readonly Delegation[];
  ready: readonly Delegation[];
  asked: Interruptions;
  weeks: WeekOfWork[];
}

export function registerNextCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
  now: () => Date = () => new Date(),
): void {
  program
    .command('next')
    .description('What you could safely let your agents do without being asked')
    .option('--since <window>', 'how far back to read, e.g. 30d', '30d')
    .option(
      '--agent <name>',
      'what that one agent would do on its own, and what it would ask',
    )
    .option('--role <name>', 'the same for a job rather than for a product')
    .option('--roles', 'every job the rules name, and what each may do')
    .option('-f, --file <path>', 'policy file to read the boundary from')
    .option(
      '--hand-over',
      'write the allow rules for everything below that is ready, rather than one at a time',
    )
    .option('--json', 'machine-readable output')
    .action(async (options: NextOptions) => runNext(context, home, now, options));
}

type NextOptions = {
  since: string;
  json?: boolean;
  handOver?: boolean;
} & BoundaryOptions;

/** What could safely be handed over next, answered from either side of the same decision. */
async function runNext(
  context: CliContext,
  home: () => string,
  now: () => Date,
  options: NextOptions,
): Promise<void> {
  // One rail for both halves of the verb, opened before either branch chooses its question.
  if (options.json !== true) context.flow.open('memnox next');

  // The rules read forwards rather than the ledger backwards: same decision, other evidence.
  if (wantsBoundary(options)) {
    await renderBoundary(context, options);
    return;
  }
  const delegable = await readDelegable(home(), now(), options.since);

  // One command for the whole list, because typing five is the work this screen ends.
  if (options.handOver === true) {
    await runAllow(
      context,
      delegable.ready.filter((each) => handable(each)).map((each) => each.action),
    );
    return;
  }
  if (options.json === true) {
    const { standing, ready, asked, weeks } = delegable;
    context.out.json({ standing, promotable: ready, interruptions: asked, weeks });
    return;
  }
  renderDelegable(context, delegable);
}

/** Reads the ledger over the window and the rules in force into one answer. */
async function readDelegable(
  home: string,
  moment: Date,
  since: string,
): Promise<Delegable> {
  const start = windowStart(since, moment);
  const week = new Date(moment.getTime() - daysToMs(DEFAULT_WINDOW_DAYS)).toISOString();

  const events = await withEvents(home, (store) =>
    store.query({ since: start, limit: LEDGER_SCAN_LIMIT }),
  );
  const found = delegations(events);
  const asked = interruptions(events, week);
  const standing = await readStanding(home, events, { asked, week });
  const weeks = weeksOfWork(events, WEEKS_SHOWN, moment);
  return { standing, found, ready: promotable(found), asked, weeks };
}

/** Where this machine sits on the autonomy ladder, from its mode, its rules and its week. */
async function readStanding(
  home: string,
  events: readonly MemnoxEvent[],
  window: { asked: Interruptions; week: string },
): Promise<AutonomyLevel> {
  const config = await loadOrCreateConfig(home);
  const rules = await policySetInForce(home);
  const gate =
    rules.policies.length === 0
      ? null
      : new LocalGate(rules.policies, { agentName: 'agent' });
  return standingOf({
    enforcing: config.mode === ENFORCEMENT_MODE.ENFORCE,
    rules: gate?.rules().length ?? 0,
    asksInWindow: window.asked.total,
    actionsInWindow: events.filter((event) => event.at >= window.week).length,
  });
}

function renderDelegable(context: CliContext, delegable: Delegable): void {
  const { flow } = context;
  const { standing, ready, asked, found } = delegable;

  flow.rows('Where you are', [{ label: standing, value: describeLevel(standing) }]);
  renderWeeks(context, delegable.weeks);
  if (ready.length > 0) renderReady(context, ready);
  if (asked.total > 0) {
    flow.table(
      `What interrupted you, ${asked.total} times in ${DEFAULT_WINDOW_DAYS} days`,
      ['Times', 'Action'],
      asked.byAction
        .slice(0, INTERRUPTIONS_SHOWN)
        .map((each) => [String(each.count), each.action]),
    );
  }
  renderVerdict(context, ready, found.length);
}

/** Questions against work, week by week, so asking less is read off the ledger rather than claimed. */
function renderWeeks(context: CliContext, weeks: readonly WeekOfWork[]): void {
  if (weeks.every((week) => week.actions === 0)) return;
  context.flow.table(
    'Week by week',
    ['Week of', 'Actions', 'Questions', 'Sessions that asked nothing'],
    weeks.map((week) => [
      week.from.slice(0, 10),
      String(week.actions),
      String(week.asked),
      `${week.unasked} of ${week.sessions}`,
    ]),
  );
}

function renderReady(context: CliContext, ready: readonly Delegation[]): void {
  context.flow.list(
    'What you could hand over',
    ready.map((each) => ({
      tone: TONE.OK,
      text: each.action,
      detail: [
        each.because,
        handable(each)
          ? `memnox protect --allow ${each.action}  (or keep being asked)`
          : `stays a question: ${heldBecause(each)}`,
      ],
    })),
  );
}

/** The same sentence `--allow` would print for it, so the screen and the command agree. */
function heldBecause(each: Delegation): string {
  const verdict = handOverVerdict(each.action, [each]);
  return verdict.ready ? 'nothing holds it back' : verdict.because;
}

function renderVerdict(
  context: CliContext,
  ready: readonly Delegation[],
  seen: number,
): void {
  const { flow, style } = context;
  if (ready.length === 0 && seen === 0) {
    // Nothing has been asked yet, which is not the same as nothing being delegable.
    flow.close('Nothing has been held for you yet, so there is nothing to hand over.');
    flow.hint('Run an agent under "memnox run" for a few days first.');
    return;
  }
  if (ready.length === 0) {
    flow.close(
      `${seen} action(s) have been held for you, and none has been approved often enough to be a habit yet.`,
    );
    return;
  }
  // A count, never hours: hours saved is a number nobody can check.
  flow.close(
    style.ok(
      `${ready.length} thing(s) you have already said yes to enough times that being asked again is the tool wasting your attention.`,
    ),
  );
  if (ready.some((each) => handable(each))) {
    flow.hint('memnox next --hand-over   writes all of them at once');
  }
}
