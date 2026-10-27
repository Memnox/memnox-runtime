/**
 * `memnox mission`: one goal across many sessions. A run joins by `--mission`, its children
 * on their own, and an orchestrator's workers by working in the mission's repository.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import {
  DAEMON_EVENT,
  describeMission,
  Missions,
  ownProcessEnv,
  PendingApprovals,
  SessionHosts,
  SessionPauses,
  SqliteEventStore,
  summarizeMission,
  withWorkersOf,
  type DaemonEvent,
  type Mission,
  type MissionSummary,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import { WaitingFeed } from '../daemon/waiting-feed';

/** Enough history for a long mission without reading a month of the ledger. */
const MISSION_EVENTS = 20_000;

interface JsonOption {
  json?: boolean;
}

interface StartOptions {
  ref?: string;
  repo?: string;
}

export function registerMissionCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
): void {
  const mission = program
    .command('mission')
    .description(
      'One goal worked on across many sessions, and where each of them stands',
    );
  mission
    .command('start <statement>')
    .description('Start one; join sessions to it with memnox run --mission <id>')
    .option('--ref <reference>', 'what it answers to, such as an incident or a ticket')
    .option('--repo <path>', 'the repository its agents work in (default: this one)')
    .action(async (statement: string, options: StartOptions) =>
      runStart(context, home(), statement, options),
    );
  registerReading(mission, context, home);
  mission
    .command('attach <id> <session>')
    .description('Join a session started some other way, such as one only the hooks see')
    .action(async (id: string, session: string) =>
      runAttach(context, home(), id, session),
    );
  mission
    .command('close <id>')
    .description('Finish it, so no further session joins')
    .action(async (id: string) => runClose(context, home(), id));
}

/** The two that only read, and so are the two that also speak JSON. */
function registerReading(
  mission: Command,
  context: CliContext,
  home: () => string,
): void {
  mission
    .command('list')
    .description('Every mission on this machine, newest first')
    .option('--json', 'machine-readable output')
    .action(async (options: JsonOption) => runList(context, home(), options));
  mission
    .command('show [id]')
    .description(
      'What its sessions did and what waits on you; the newest open one without an id',
    )
    .option('--json', 'machine-readable output')
    .action(async (id: string | undefined, options: JsonOption) =>
      runShow(context, home(), id, options),
    );
}

async function runStart(
  context: CliContext,
  home: string,
  statement: string,
  options: StartOptions,
): Promise<void> {
  const { flow } = context;
  flow.open('memnox mission start');
  const root = repositoryAt(resolve(options.repo ?? process.cwd()));
  const mission = await new Missions(home).start(statement, {
    now: new Date().toISOString(),
    ...(options.ref === undefined ? {} : { reference: options.ref }),
    ...(root === null ? {} : { root }),
  });
  flow.rows('Started', [
    { label: 'mission', value: mission.id },
    { label: 'asked for', value: mission.statement },
    ...(mission.reference === undefined
      ? []
      : [{ label: 'answers to', value: mission.reference }]),
    ...(root === null
      ? []
      : [{ label: 'repository', value: `${root}, and its worktrees` }]),
  ]);
  flow.close(
    root === null
      ? 'No session has joined it yet.'
      : 'Every agent that works in this repository from now on is part of it.',
  );
  flow.hint(`memnox run --mission ${mission.id} -- <agent>`);
}

async function runList(
  context: CliContext,
  home: string,
  options: JsonOption,
): Promise<void> {
  const missions = await new Missions(home).all();
  if (options.json === true) {
    context.out.json(missions);
    return;
  }
  const { flow } = context;
  flow.open('memnox mission list');
  if (missions.length === 0) {
    flow.close('No mission on this machine.');
    flow.hint('memnox mission start "<what the agents are here to do>"');
    return;
  }
  flow.list(
    'Missions',
    missions.map((mission) => ({
      text: `${mission.id}  ${mission.statement}`,
      detail: [
        `${mission.sessions.length} session(s), ${mission.closedAt === undefined ? 'open' : 'closed'}`,
      ],
    })),
  );
  flow.close(`${missions.length} mission(s).`);
}

/** The screen for coming back: where each session stands, and what is waiting on you. */
async function runShow(
  context: CliContext,
  home: string,
  id: string | undefined,
  options: JsonOption,
): Promise<void> {
  const mission = await missionNamed(home, id);
  const summary = await summaryOf(home, await withWorkers(home, mission));
  const members = new Set(summary.mission.sessions);
  const waiting = (await new WaitingFeed(home).current(new Date().toISOString())).filter(
    (event) => event.sessionId === undefined || members.has(event.sessionId),
  );
  if (options.json === true) {
    context.out.json({ ...summary, waiting });
    return;
  }
  const { flow } = context;
  flow.open('memnox mission show');
  const [heading, ...rest] = describeMission(summary);
  flow.box(
    heading ?? mission.id,
    rest.map((line) => line.trim()),
  );
  flow.list(
    'Sessions',
    summary.standings.map((each) => ({ text: each.sessionId, detail: [each.standing] })),
  );
  if (waiting.length > 0) flow.list('Waiting on you', waiting.map(waitingItem));
  flow.close('memnox replay <session> tells any one of them in order.');
}

/** The one named, or the newest still open, since coming back is about the work in hand. */
async function missionNamed(home: string, id: string | undefined): Promise<Mission> {
  const missions = new Missions(home);
  const mission =
    id === undefined
      ? ((await missions.all()).find((each) => each.closedAt === undefined) ?? null)
      : await missions.read(id);
  if (mission !== null) return mission;
  throw new Error(
    id === undefined
      ? 'no open mission; "memnox mission start" begins one'
      : `no mission ${id}; "memnox mission list" shows them`,
  );
}

/** One line per thing, saying what to do where a command does it. */
function waitingItem(event: DaemonEvent): { text: string; detail: string[] } {
  if (event.kind === DAEMON_EVENT.HELD)
    return { text: event.summary, detail: [`memnox approve ${event.subject}`] };
  if (event.kind === DAEMON_EVENT.PAUSED)
    return { text: event.summary, detail: [`memnox resume ${event.subject}`] };
  return { text: event.summary, detail: [] };
}

/** The sessions found in the mission's repository and worktrees, added to those that joined. */
async function withWorkers(home: string, mission: Mission): Promise<Mission> {
  if (mission.root === undefined) return mission;
  const places = await new SessionHosts(home).all().catch(() => []);
  return withWorkersOf(mission, places, worktreesOf(mission.root));
}

/** The repository and every worktree of it, where a team of agents each takes a checkout. */
function worktreesOf(root: string): string[] {
  const listed = git(root, ['worktree', 'list', '--porcelain']);
  if (listed === null) return [root];
  const trees = listed
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  return trees.length === 0 ? [root] : trees;
}

function repositoryAt(dir: string): string | null {
  return git(dir, ['rev-parse', '--show-toplevel'])?.trim() ?? null;
}

function git(dir: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      // The real git: the one on PATH may be the interceptor, which would rule on this.
      env: ownProcessEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Not a repository, which is an answer rather than a failure.
    return null;
  }
}

/** The ledger, the questions still open and the pauses holding, read once for the whole mission. */
async function summaryOf(home: string, mission: Mission): Promise<MissionSummary> {
  const now = new Date().toISOString();
  const store = SqliteEventStore.forHome(home);
  let events;
  try {
    events = await store.query({
      limit: MISSION_EVENTS,
      ...(mission.startedAt === '' ? {} : { since: mission.startedAt }),
    });
  } finally {
    store.close();
  }
  const pending = await new PendingApprovals(home).list(now);
  const pauses = await new SessionPauses(home).all();
  return summarizeMission(mission, events, {
    waiting: new Set(
      pending
        .filter((each) => each.answer === undefined)
        .map((each) => each.request.sessionId),
    ),
    stopped: new Set(
      pauses.filter((each) => each.resumedAt === undefined).map((each) => each.sessionId),
    ),
  });
}

async function runAttach(
  context: CliContext,
  home: string,
  id: string,
  session: string,
): Promise<void> {
  context.flow.open('memnox mission attach');
  const mission = await new Missions(home).attach(id, session);
  context.flow.close(
    `${session} is part of "${mission.statement}", one of ${mission.sessions.length} session(s).`,
  );
}

async function runClose(context: CliContext, home: string, id: string): Promise<void> {
  context.flow.open('memnox mission close');
  const mission = await new Missions(home).close(id, new Date().toISOString());
  context.flow.close(
    `"${mission.statement}" is closed, after ${mission.sessions.length} session(s).`,
  );
}
