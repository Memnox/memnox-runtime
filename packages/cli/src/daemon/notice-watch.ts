import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  shortDigest,
  AGENT_ID_PREFIX,
  AgentsFirst,
  Clashes,
  concurrentWork,
  DAEMON_EVENT,
  DECISION_EFFECT,
  DEFAULT_COLLISION_WINDOW_MINUTES,
  LEDGER_SCAN_LIMIT,
  LEDGER_SESSION_LIMIT,
  minutesToMs,
  NOTICE_KIND,
  noticeSubject,
  describeRun,
  runTally,
  noticesFrom,
  PendingApprovals,
  SessionHosts,
  SessionPauses,
  SessionTasks,
  SessionTurns,
  SessionWatches,
  startWatch,
  watchFired,
  workObservationsOf,
  type Collision,
  type DaemonEvent,
  type NoticeWatch,
  type SessionNotice,
  type RunTally,
  type MemnoxEvent,
  type SessionWatch,
  type TurnTests,
  turnTests,
  type WatchFacts,
  type WatchFired,
} from '@memnox/core';
import { displayName, readNames } from '../agents/names';
import { withEvents } from '../event-store';
import { repositoriesWritten, touchesOf } from '../session-tools/session-writes';
import { readTestRuns, sessionTranscript } from './transcript';
import { commandResults, type CommandResult } from '../session-tools/voice-commands';
import { SessionLives } from './session-lifecycle';
import { WorkspaceStream } from './workspace-stream';
import { SessionViews } from './session-view';
import { SignInWatcher } from './sign-in-watch';
import { personalAccounts } from '../sync/personal-work';
import { readWorkspaceName } from '../sync/workspace-reads';

/**
 * Looks at the ledger for what is worth saying unasked, and keeps what it told for a while
 * so the voice can brief it in its own words. Starts from the moment the daemon did, since
 * a list of everything that happened before somebody was listening is not news.
 */

/** A few at once at most: a run of notices is a briefing nobody asked for. */
const MOST_AT_ONCE = 3;
/** Long enough for the app to ask for the brief, short enough that the map never grows. */
const KEEP_MS = 10 * 60 * 1_000;

/** Said after a hold by another machine the agents could not settle, so the person knows its owner is one sentence away. */
const ASK_THE_OWNER =
  ' The agents could not settle it between them. You can ask its owner for it, and they will hear you now.';

/** How often the clash folder is looked at: one stat, so the notch hears of a clash well inside a second. */
const CLASH_LOOK_MS = 200;

export class NoticeWatcher {
  private watch: NoticeWatch;
  private readonly told = new Map<string, DaemonEvent>();
  /** Background commands whose end was told, kept for the daemon's life so none is told twice. */
  private readonly ended = new Set<string>();
  /** Every session as it begins and ends, so none comes or goes unnoticed. */
  private readonly lives: SessionLives;
  /** Pairs of sessions already told as colliding, so a pair working on for an hour is said once. */
  private readonly collided = new Set<string>();
  /** The newest clash told, so each held write is said once. */
  private clashSeen: string;
  /** Every clash told, since the watch and the look can both read one before either moves `clashSeen`. */
  private readonly clashTold = new Set<string>();
  /** Holds by another machine wait for the two agents to settle them before anybody is told. */
  private readonly agentsFirst = new AgentsFirst();
  private clashTimer: ReturnType<typeof setInterval> | null = null;
  /** What other people in the workspace say to this person, held open while somebody listens. */
  private workspace: WorkspaceStream | null = null;
  /** When the clash folder last changed, so a look that finds it unchanged reads nothing. */
  private clashFolderAt = 0;
  /** Sign ins the person was offered, told once each finishes so the voice carries on. */
  private readonly signIns: SignInWatcher;

  constructor(
    private readonly home: string,
    private readonly started: string,
  ) {
    this.watch = startWatch(started);
    this.clashSeen = started;
    this.lives = new SessionLives(home, started);
    this.signIns = new SignInWatcher(home, () => personalAccounts(home));
  }

  /** New notices since the last look, as events ready to send. */
  async look(moment: string): Promise<DaemonEvent[]> {
    const since = this.watch.seen;
    const events = await withEvents(this.home, (store) =>
      store.query({ since, limit: LEDGER_SCAN_LIMIT }),
    );
    const turns = await new SessionTurns(this.home).all();
    const { watch, notices } = noticesFrom(this.watch, events, turns);
    this.watch = watch;
    const fresh = await Promise.all(
      notices.slice(-MOST_AT_ONCE).map((each) => this.eventFor(each)),
    );
    for (const [subject, event] of this.told) {
      if (Date.parse(moment) - Date.parse(event.at) > KEEP_MS) this.told.delete(subject);
    }
    const watched = await this.watched(moment);
    const finished = await this.commandsEnded(moment);
    const met = [...(await this.collisions(moment)), ...(await this.clashes(moment))];
    const lived = await this.lives.look(moment);
    const signedIn = await this.signIns.look(moment);
    const all = [...fresh, ...watched, ...finished, ...met, ...lived, ...signedIn];
    for (const event of all) this.told.set(event.subject, event);
    return all;
  }

  /** Two sessions working on the same files at once, each pair told once with what they share. */
  private async collisions(moment: string): Promise<DaemonEvent[]> {
    const windowStart =
      Date.parse(moment) - minutesToMs(DEFAULT_COLLISION_WINDOW_MINUTES);
    const since = new Date(Math.max(windowStart, Date.parse(this.started))).toISOString();
    const events = await withEvents(this.home, (store) =>
      store.query({ since, limit: LEDGER_SCAN_LIMIT }),
    );
    const pairs = new Map<string, Collision[]>();
    for (const collision of concurrentWork(workObservationsOf(events), { now: moment })) {
      const key = collision.agents
        .map((agent) => agent.agentId)
        .sort()
        .join('\n');
      if (this.collided.has(key)) continue;
      pairs.set(key, [...(pairs.get(key) ?? []), collision]);
    }
    const names = await readNames(this.home);
    return [...pairs].slice(0, MOST_AT_ONCE).map(([key, shared]) => {
      this.collided.add(key);
      return collisionEvent(key, shared, (agent) => nameOf(names, agent), moment);
    });
  }

  /** A write held because another agent here or on another machine had it, each told once. */
  private async clashes(moment: string): Promise<DaemonEvent[]> {
    const fresh = (
      await new Clashes(this.home).since(this.clashSeen, moment).catch(() => [])
    ).filter((clash) => !this.clashTold.has(clash.id));
    for (const clash of fresh) this.clashTold.add(clash.id);
    const last = fresh.at(-1);
    if (last !== undefined) this.clashSeen = last.at;
    const names = await readNames(this.home);
    return this.agentsFirst
      .forPerson(fresh)
      .slice(-MOST_AT_ONCE)
      .map((clash) => {
        const agentName = nameOf(names, clash.agent);
        return {
          kind: DAEMON_EVENT.NOTICE,
          subject: `ntc_collision_${clash.id}`,
          agent: clash.agent,
          agentName,
          notice: NOTICE_KIND.COLLISION,
          sessionId: clash.sessionId,
          summary: `${agentName} was held off ${basename(clash.what)} because another agent has it: ${clash.said}${clash.leaseId === undefined ? '' : ASK_THE_OWNER}`,
          at: clash.at,
        };
      });
  }

  /**
   * Each clash within a fraction of a second, and what other people ask through the workspace
   * as they ask it, since the agent held off is choosing what to do right now. A folder stat,
   * not a file watch, which some machines refuse and which throws out of band.
   */
  followCollisions(tell: (event: DaemonEvent) => void, now: () => string): void {
    if (this.clashTimer !== null) return;
    this.workspace = new WorkspaceStream({ home: this.home, tell, now });
    this.workspace.start();
    const dir = Clashes.directory(this.home);
    this.clashTimer = setInterval(() => {
      void this.clashFolderMoved(dir)
        .then((moved) => (moved ? this.clashes(now()) : []))
        .then((events) => {
          for (const event of events) {
            this.told.set(event.subject, event);
            tell(event);
          }
        })
        .catch(() => undefined);
    }, CLASH_LOOK_MS);
    // Looking is never a reason to keep a daemon alive that was asked to stop.
    this.clashTimer.unref();
  }

  close(): void {
    if (this.clashTimer !== null) clearInterval(this.clashTimer);
    this.clashTimer = null;
    this.workspace?.stop();
    this.workspace = null;
  }

  /** Writing a clash renames a file into the folder, which moves the folder's own time. */
  private async clashFolderMoved(dir: string): Promise<boolean> {
    const at = await stat(dir).then(
      (found) => found.mtimeMs,
      () => 0,
    );
    if (at === this.clashFolderAt) return false;
    this.clashFolderAt = at;
    return true;
  }

  /** A login or onboarding that ran on its own after Touch ID and has now ended, each told once; only a failure needs the person. */
  private async commandsEnded(moment: string): Promise<DaemonEvent[]> {
    const events: DaemonEvent[] = [];
    const results = await commandResults(this.home)
      .all()
      .catch(() => []);
    // Said beside each ending, so one finishing is never told as all of them finishing.
    const still = results.filter(
      (each) => each.running === true && each.doneAt === undefined,
    );
    for (const result of results) {
      const key = `${result.at} ${result.argv.join(' ')}`;
      if (result.doneAt === undefined || result.doneAt < this.started) continue;
      if (this.ended.has(key)) continue;
      this.ended.add(key);
      // Said by name, since "your workspace" after a login cannot tell them they joined the wrong one.
      const workspace =
        result.argv[0] === 'login' && result.exitCode === 0
          ? await readWorkspaceName(this.home).catch(() => null)
          : null;
      events.push({
        kind: DAEMON_EVENT.NOTICE,
        subject: `ntc_command_${shortDigest(key)}`,
        agent: 'memnox',
        agentName: 'Memnox',
        notice: result.exitCode === 0 ? NOTICE_KIND.ENDED : NOTICE_KIND.WATCHED,
        summary: [commandEnding(result, workspace), stillRunning(still)]
          .filter((line) => line !== '')
          .join(' '),
        at: moment,
      });
    }
    return events;
  }

  /** What the person asked to be told about that has now happened, each said once. */
  private async watched(moment: string): Promise<DaemonEvent[]> {
    const watches = new SessionWatches(this.home);
    const open = await watches.open(moment);
    if (open.length === 0) return [];
    const heldSessions = (await new PendingApprovals(this.home).list(moment))
      .filter((each) => each.answer === undefined)
      .map((each) => each.request.sessionId);
    const events: DaemonEvent[] = [];
    for (const waiting of open) {
      const watch = await this.bound(watches, waiting);
      if (watch.sessionId === '') continue;
      const fired = watchFired(watch, await this.factsFor(watch, heldSessions));
      if (fired === null) continue;
      await watches.done(watch.id);
      events.push(await this.watchEvent(fired, moment));
    }
    return events;
  }

  /** A watch set on a session just started, tied to it as soon as that session shows up. */
  private async bound(
    watches: SessionWatches,
    watch: SessionWatch,
  ): Promise<SessionWatch> {
    const awaiting = watch.awaiting;
    if (awaiting === undefined || watch.sessionId !== '') return watch;
    const place = basename(awaiting.repository);
    const cards = await new SessionViews(this.home).list().catch(() => []);
    const found = cards.find(
      (card) =>
        card.repository === place &&
        (card.startedAt ?? card.lastActive ?? '') >= awaiting.since,
    );
    return found === undefined ? watch : watches.bind(watch, found.sessionId);
  }

  private async factsFor(
    watch: SessionWatch,
    heldSessions: readonly string[],
  ): Promise<WatchFacts> {
    const [turn, pause] = await Promise.all([
      new SessionTurns(this.home).read(watch.sessionId),
      new SessionPauses(this.home).inForce(watch.sessionId),
    ]);
    const transcript = await sessionTranscript(this.home, watch.sessionId);
    return {
      ...(turn?.promptAt === undefined ? {} : { promptAt: turn.promptAt }),
      ...(turn?.endedAt === undefined ? {} : { endedAt: turn.endedAt }),
      testRuns: transcript === null ? [] : readTestRuns(transcript),
      paused: pause !== null,
      held: heldSessions.filter((each) => each === watch.sessionId).length,
    };
  }

  private async watchEvent(fired: WatchFired, moment: string): Promise<DaemonEvent> {
    const { watch } = fired;
    const base = await this.eventFor({
      kind: NOTICE_KIND.WATCHED,
      sessionId: watch.sessionId,
      agent: watch.agent,
      at: moment,
    });
    const asked = watch.said === undefined ? '' : ` They asked: "${watch.said}".`;
    return {
      ...base,
      subject: `ntc_watched_${watch.id}`,
      summary: `${base.agentName ?? watch.agent}: ${fired.what}.${asked}`,
    };
  }

  /** A notice told lately, for the voice to brief by its subject. */
  recent(subject: string): DaemonEvent | null {
    return this.told.get(subject) ?? null;
  }

  private async eventFor(notice: SessionNotice): Promise<DaemonEvent> {
    const rows = await withEvents(this.home, (store) =>
      store.query({ sessionId: notice.sessionId, limit: LEDGER_SESSION_LIMIT }),
    );
    const touches = touchesOf(rows);
    const [task, host, names, tests] = await Promise.all([
      new SessionTasks(this.home).read(notice.sessionId),
      new SessionHosts(this.home).read(notice.sessionId),
      readNames(this.home),
      notice.kind === NOTICE_KIND.FINISHED
        ? this.testsIn(
            notice,
            touches.map((touch) => touch.at),
          )
        : Promise.resolve(null),
    ]);
    const wrote = repositoriesWritten(touches)[0];
    // Where it last wrote beats where it was opened, since a task often names another repository.
    const place = wrote ?? host?.cwd;
    const id = notice.agent.startsWith(AGENT_ID_PREFIX)
      ? notice.agent
      : `${AGENT_ID_PREFIX}${notice.agent}`;
    const agentName = displayName(names, { id, kind: notice.agent });
    const run = finishedRun(notice, rows);
    return {
      kind: DAEMON_EVENT.NOTICE,
      subject: noticeSubject(notice.kind, notice.sessionId, notice.at),
      agent: notice.agent,
      summary: withRun(sentenceFor(agentName, notice), run),
      ...(run === null ? {} : { run }),
      at: notice.at,
      notice: notice.kind,
      agentName,
      sessionId: notice.sessionId,
      ...(task === null ? {} : { task: task.statement }),
      ...(place === undefined ? {} : { place: basename(place) }),
      ...(tests === null ? {} : { tests }),
    };
  }

  /** How the finished turn left its tests, from the agent's own transcript and the writes the ledger saw. */
  private async testsIn(
    notice: SessionNotice,
    writesAt: readonly string[],
  ): Promise<TurnTests | null> {
    const [turn, transcript] = await Promise.all([
      new SessionTurns(this.home).read(notice.sessionId),
      sessionTranscript(this.home, notice.sessionId),
    ]);
    if (turn?.promptAt === undefined || transcript === null) return null;
    const span = { promptAt: turn.promptAt, endedAt: notice.at };
    return turnTests(span, readTestRuns(transcript), writesAt);
  }
}

/** How a command that ran on its own ended, plainly, with the last thing it printed when it failed. */
function commandEnding(result: CommandResult, workspace: string | null): string {
  const what = commandWords(result, workspace);
  if (result.exitCode === 0) return `${what} is done; it worked.`;
  const lines = result.output.split('\n').filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1]?.trim() ?? 'it stopped';
  return `${what} did not finish. It said: "${last.slice(0, 200)}".`;
}

/** Login by its purpose, and an onboarding by the agents it names, so the brain says which. */
function commandWords(result: CommandResult, workspace: string | null): string {
  if (result.argv[0] === 'login')
    return workspace === null
      ? 'Connecting this machine to the Memnox workspace'
      : `Connecting this machine to the workspace called ${workspace}`;
  if (result.argv[0] === 'agents' && result.argv[1] === 'onboard') {
    const agents = result.argv.slice(2).filter((each) => !each.startsWith('-'));
    return `Onboarding ${agents.length === 0 ? 'an agent' : agents.join(', ')}`;
  }
  return `memnox ${result.argv.slice(0, 2).join(' ')}`;
}

/** What has not ended yet, so it is never counted as done. */
function stillRunning(still: readonly CommandResult[]): string {
  if (still.length === 0) return '';
  return `Still running, not done yet: ${still.map((each) => commandWords(each, null)).join('; ')}.`;
}

/** The notice's sentence, and for a finished turn what it came to, so "asked you nothing" is said with it. */
function withRun(sentence: string, run: RunTally | null): string {
  const told = run === null ? '' : describeRun(run);
  return told === '' ? sentence : `${sentence} ${told}`;
}

/** The turn a finished notice closes, counted over the minutes it ran, and nothing for any other notice. */
function finishedRun(
  notice: SessionNotice,
  rows: readonly MemnoxEvent[],
): RunTally | null {
  if (notice.kind !== NOTICE_KIND.FINISHED || notice.minutes === undefined) return null;
  const from = new Date(Date.parse(notice.at) - notice.minutes * 60_000).toISOString();
  return runTally(rows, from, notice.at);
}

/** The facts as one plain sentence, said as they are when the brain cannot word them. */
function sentenceFor(agent: string, notice: SessionNotice): string {
  if (notice.kind === NOTICE_KIND.COMMITTED) return `${agent} just made a commit.`;
  if (notice.kind === NOTICE_KIND.WOULD_HAVE) {
    const did = notice.wouldHave === DECISION_EFFECT.DENY ? 'refused' : 'asked you about';
    return `${agent} just ran ${notice.action ?? 'something'}. Your rule ${notice.rule ?? ''} would have ${did} it, but Memnox is only watching on this machine, so it went through.`;
  }
  if (notice.kind === NOTICE_KIND.PUSHED) {
    return `${agent} just pushed${notice.target === undefined ? '' : ` to ${notice.target}`}.`;
  }
  return `${agent} finished a turn of about ${notice.minutes ?? 0} minutes and is waiting on you.`;
}

/** Most files named in one collision, so the sentence stays one sentence. */
const MOST_FILES_NAMED = 3;

/** One pair of sessions and the files they share, said plainly with who is writing. */
function collisionEvent(
  key: string,
  shared: readonly Collision[],
  named: (agent: string) => string,
  moment: string,
): DaemonEvent {
  const agents = shared[0]?.agents ?? [];
  const who = agents.map((agent) => named(agent.agentName));
  const files = shared.map((each) => basename(each.target));
  const listed = files.slice(0, MOST_FILES_NAMED).join(', ');
  const more =
    files.length > MOST_FILES_NAMED ? ` and ${files.length - MOST_FILES_NAMED} more` : '';
  const writers = agents
    .filter((agent) => agent.writing)
    .map((agent) => named(agent.agentName));
  const first = agents[0];
  return {
    kind: DAEMON_EVENT.NOTICE,
    subject: `ntc_collision_${shortDigest(key)}`,
    agent: first?.agentName ?? 'unknown',
    agentName: who[0] ?? 'An agent',
    notice: NOTICE_KIND.COLLISION,
    ...(first === undefined ? {} : { sessionId: first.agentId }),
    summary: `${who.join(' and ')} are working on the same files at once on this machine: ${listed}${more}. ${writers.join(' and ')} ${writers.length > 1 ? 'are' : 'is'} writing.`,
    at: moment,
  };
}

/** The name the person chose for an agent, from its product name. */
function nameOf(names: Awaited<ReturnType<typeof readNames>>, agent: string): string {
  const id = agent.startsWith(AGENT_ID_PREFIX) ? agent : `${AGENT_ID_PREFIX}${agent}`;
  return displayName(names, { id, kind: agent });
}
