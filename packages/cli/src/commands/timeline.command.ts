import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';

import type { Command } from 'commander';

import {
  buildBundle,
  DECISION_EFFECT,
  generateKeys,
  verbForAction,
  verbTableFor,
  loadOrCreateConfig,
  type DecisionEffect,
  type EventQuery,
  type MemnoxEvent,
  helperOf,
  dropOldRecords,
  type RecordsDropped,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import type { FlowRow } from '../flow';
import { DAY_MS, since } from '../duration';
import { withEvents } from '../event-store';
import { positiveInteger } from '../positive-integer';

/**
 * `memnox timeline`: what the agents on this machine did, in order, or exported as a
 * signed bundle for an auditor. `memnox purge` drops what is past retention.
 */

const TIME_OF_DAY_START = 'YYYY-MM-DDT'.length;
const TIME_OF_DAY_END = TIME_OF_DAY_START + 'HH:MM:SS'.length;

const DATE_LENGTH = 'YYYY-MM-DD'.length;

/** `2026-09-23T14:05:31.000Z` gives `14:05:31`, because the date repeats down a column. */
function timeOfDay(at: string): string {
  return at.slice(TIME_OF_DAY_START, TIME_OF_DAY_END);
}

const DEFAULT_LIMIT = 200;

/** `--only` takes an effect, so a reader can ask for just what did not proceed. */
const ONLY: Readonly<Record<string, DecisionEffect[]>> = {
  allow: [DECISION_EFFECT.ALLOW],
  ask: [DECISION_EFFECT.ASK],
  deny: [DECISION_EFFECT.DENY],
  blocked: [DECISION_EFFECT.DENY, DECISION_EFFECT.ASK],
};

/** One action, as the cells of a timeline row. */
function cells(context: CliContext, event: MemnoxEvent): string[] {
  const { style } = context;
  const what =
    event.target === undefined ? event.operation : `${event.operation} ${event.target}`;
  // Empty rather than styled empty, because colour codes around nothing still print.
  const outcome =
    event.exitCode === undefined || event.exitCode === 0
      ? ''
      : style.dim(`exit ${event.exitCode}`);
  return [
    timeOfDay(event.at),
    `${style.symbol(event.effect)}${style.effect(event.effect, event.effect)}`,
    // "preview" and "production" are the words that make a deploy line readable.
    `${what}${verbNote(event.operation)}${helperNote(context, event)}`,
    outcome,
  ];
}

/** Which helper did it, since a session's rows are otherwise all filed under its agent. */
function helperNote(context: CliContext, event: MemnoxEvent): string {
  if (event.subagent === undefined) return '';
  return context.style.dim(`  ${helperOf(event.subagent, event.subagentType)}`);
}

function render(context: CliContext, events: readonly MemnoxEvent[]): void {
  const { flow } = context;
  if (events.length === 0) {
    flow.close('Nothing recorded yet.');
    flow.hint('Wrap an agent with "memnox mcp wrap", then use it.');
    return;
  }

  // Grouped by session, because one session is one piece of work somebody did.
  const sessions = new Map<string, MemnoxEvent[]>();
  for (const event of events) {
    const rows = sessions.get(event.sessionId) ?? [];
    rows.push(event);
    sessions.set(event.sessionId, rows);
  }

  for (const [sessionId, rows] of sessions) {
    // Safe: a session is only in the map once it has a row.
    const first = rows[0] as MemnoxEvent;
    flow.table(
      `${first.agent}  ${sessionId}  ${first.at.slice(0, DATE_LENGTH)}`,
      ['Time', '', 'Action', ''],
      rows.map((event) => cells(context, event)),
    );
  }
  flow.close(`${events.length} action(s) across ${sessions.size} session(s).`);
  flow.hint('One of them end to end: "memnox trace <id>".');
}

export function registerTimelineCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
  now: () => Date = () => new Date(),
): void {
  program
    .command('timeline')
    .description('What the agents on this machine actually did, in order')
    .option('--session <id>', 'one session only')
    .option('--agent <name>', 'one agent only')
    .option('--since <when>', 'e.g. 30m, 2h, 7d, or an ISO timestamp')
    .option('--only <effect>', `allow | ask | deny | blocked`)
    .option('--limit <n>', 'how many actions', String(DEFAULT_LIMIT))
    .option('--export <format>', 'jsonl | json | bundle')
    .option('--out <path>', 'write the bundle here instead of to the terminal')
    .option('--follow', 'keep printing each action as it happens, until Ctrl+C')
    .action(async (options: TimelineOptions) =>
      options.follow === true
        ? followTimeline(context, { home, now }, buildFilter(options, now()))
        : runTimeline(context, home, now, options),
    );
}

/** How often a followed ledger is read again: often enough to feel live, cheap enough to leave open. */
const FOLLOW_EVERY_MS = 1_500;

interface FollowDeps {
  home: () => string;
  now: () => Date;
  wait?: (ms: number) => Promise<void>;
  /** How many reads before stopping; a test gives one, a person gives none and presses Ctrl+C. */
  rounds?: number;
}

/**
 * Every action as it lands, one line each with its agent and session, for a person with no app
 * open who still wants to watch an agent work, on a server over SSH above all.
 */
export async function followTimeline(
  context: CliContext,
  deps: FollowDeps,
  filter: EventQuery,
): Promise<void> {
  const { flow } = context;
  flow.open('memnox timeline --follow');
  flow.aside('Following this machine. Ctrl+C stops.');
  const seen = new Set<string>();
  const wait = deps.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  for (let round = 0; deps.rounds === undefined || round < deps.rounds; round++) {
    const events = await withEvents(deps.home(), (store) => store.query(filter));
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      flow.aside(
        `${event.agent}  ${cells(context, event)
          .filter((cell) => cell !== '')
          .join('  ')}`,
      );
    }
    if (deps.rounds === undefined || round + 1 < deps.rounds) await wait(FOLLOW_EVERY_MS);
  }
}

interface TimelineOptions {
  session?: string;
  agent?: string;
  since?: string;
  only?: string;
  limit: string;
  export?: string;
  out?: string;
  follow?: boolean;
}

/** What the agents on this machine actually did, in order, or exported for a reader. */
async function runTimeline(
  context: CliContext,
  home: () => string,
  now: () => Date,
  options: TimelineOptions,
): Promise<void> {
  if (options.export === undefined) context.flow.open('memnox timeline');
  const filter = buildFilter(options, now());
  await withEvents(home(), async (store) => {
    const events = await store.query(filter);
    if (options.export === 'bundle') {
      // The bundle is what a caller redirects, so the rail moves to stderr.
      context.flow.commentary();
      context.flow.open('memnox timeline --export bundle');
      await writeBundle(context, { events, filter, out: options.out, moment: now() });
      return;
    }
    if (options.export === 'jsonl') {
      // One row per line, never indented: jsonl is read by a tool, not a person.
      for (const event of events) context.out.line(JSON.stringify(event));
      return;
    }
    if (options.export === 'json') {
      context.out.json(events);
      return;
    }
    render(context, events);
  });
}

function buildFilter(options: TimelineOptions, moment: Date): EventQuery {
  if (options.only !== undefined && ONLY[options.only] === undefined) {
    throw new Error(
      `--only takes one of: ${Object.keys(ONLY).join(', ')}. Got "${options.only}".`,
    );
  }
  // Config changes are part of what happened here, so the timeline asks for them.
  const filter: EventQuery = {
    limit: positiveInteger(options.limit, '--limit'),
    withConfig: true,
  };
  if (options.session !== undefined) filter.sessionId = options.session;
  if (options.agent !== undefined) filter.agent = options.agent;
  if (options.since !== undefined) filter.since = since(options.since, moment);
  if (options.only !== undefined) filter.effects = ONLY[options.only];
  return filter;
}

export function registerPurgeCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
  now: () => Date = () => new Date(),
): void {
  program
    .command('purge')
    .description('Drop history older than the retention window in your config')
    .option('--days <n>', 'override the configured retention for this run')
    .option('--dry-run', 'say what would go and delete nothing')
    .action(async (options: PurgeOptions) => runPurge(context, home, now, options));
}

interface PurgeOptions {
  days?: string;
  dryRun?: boolean;
}

/** Drops history past the retention window, or says what would go. */
async function runPurge(
  context: CliContext,
  home: () => string,
  now: () => Date,
  options: PurgeOptions,
): Promise<void> {
  const { flow } = context;
  flow.open('memnox purge');
  const days = await retentionDaysOf(home(), options.days);
  const cutoff = new Date(now().getTime() - days * DAY_MS).toISOString();
  const records = await dropOldRecords({
    home: home(),
    cutoff,
    now: now().toISOString(),
    ...(options.dryRun === true ? { dryRun: true } : {}),
  });
  await withEvents(home(), async (store) => {
    if (options.dryRun === true) {
      const doomed = await store.query({ until: cutoff, withConfig: true });
      flow.rows('Would drop', [
        { label: 'older than', value: `${days} days, before ${cutoff}` },
        { label: 'events', value: String(doomed.length) },
        ...recordRows(records),
      ]);
      flow.close('Nothing was deleted.');
      flow.hint('Run it without --dry-run to drop them.');
      return;
    }
    const dropped = await store.pruneBefore(cutoff);
    flow.rows('Dropped', [
      { label: 'older than', value: `${days} days, before ${cutoff}` },
      { label: 'events', value: String(dropped) },
      ...recordRows(records),
    ]);
    flow.close(`${dropped} event(s) older than ${days} days dropped.`);
  });
}

/** The window asked for, or the one configured, refused unless it is a whole number of days. */
async function retentionDaysOf(home: string, given: string | undefined): Promise<number> {
  if (given !== undefined) return positiveInteger(given, '--days');
  const config = await loadOrCreateConfig(home);
  return config.retentionDays;
}

/** The records beside the ledger, one row per kind that had any to drop. */
function recordRows(records: RecordsDropped): FlowRow[] {
  return Object.entries(records)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ label: kind, value: String(count) }));
}

/** The verb table's own note, so a timeline says which kind of deploy it was. */
function verbNote(operation: string): string {
  const verb = verbForAction(operation, verbTableFor);
  if (verb === null || verb.note === undefined) return '';
  return `  (${verb.note})`;
}

interface BundleInput {
  events: readonly MemnoxEvent[];
  filter: EventQuery;
  out: string | undefined;
  moment: Date;
}

/**
 * A period of history, signed, so an auditor reads evidence rather than an editable file.
 * It states what was left out, because an export that quietly omitted a day would be relied on.
 */
async function writeBundle(context: CliContext, input: BundleInput): Promise<void> {
  const { events, filter, out, moment } = input;
  const excluded = exclusionsOf(events, filter);
  const { header, body } = buildBundle({
    events,
    range: {
      from: filter.since ?? events[0]?.at ?? moment.toISOString(),
      to: filter.until ?? events[events.length - 1]?.at ?? moment.toISOString(),
    },
    createdAt: moment.toISOString(),
    excluded,
    keys: generateKeys(),
  });

  const bundle = `${JSON.stringify(header, null, 2)}\n\n${body}\n`;
  const { flow } = context;
  if (out === undefined) {
    context.out.line(bundle);
    flow.close(`${header.events} event(s), signed.`);
    for (const each of excluded) flow.hint(`not included: ${each}`);
    return;
  }
  await writeFile(out, bundle, { encoding: 'utf8', mode: 0o600 });
  flow.rows('Written', [
    { label: 'file', value: out },
    { label: 'events', value: String(header.events) },
    { label: 'covers', value: `${header.range.from} to ${header.range.to}` },
  ]);
  flow.close(`${header.events} event(s), signed.`);
  flow.hint(`Check it with "memnox verify ${out}".`);
  for (const each of excluded) flow.hint(`not included: ${each}`);
}

/** What the filter kept out of a bundle, said in the bundle itself. */
function exclusionsOf(events: readonly MemnoxEvent[], filter: EventQuery): string[] {
  const excluded: string[] = [];
  if (filter.limit !== undefined && events.length === filter.limit) {
    excluded.push(
      `stopped at --limit ${filter.limit}; older events exist and are not included`,
    );
  }
  if (filter.effects !== undefined) {
    excluded.push(`only ${filter.effects.join(', ')} events were asked for`);
  }
  return excluded;
}
