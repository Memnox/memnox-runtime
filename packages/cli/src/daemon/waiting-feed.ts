import { basename } from 'node:path';
import {
  AGENT_ID_PREFIX,
  AgentQuestions,
  DAEMON_EVENT,
  describeHeldCall,
  Devices,
  DisplayRequests,
  plainAsk,
  proposalCapability,
  REMOTE_CAPABILITY,
  PendingApprovals,
  Proposals,
  PROPOSAL_KIND,
  SessionHosts,
  SessionTasks,
  NOTICE_KIND,
  noticeSubject,
  UNNAMED_AGENT,
  awayTurn,
  describeAwayTurn,
  describePause,
  LEDGER_SESSION_LIMIT,
  SessionPauses,
  POST_KIND,
  SessionPosts,
  SessionTurns,
  type SessionPost,
  type AgentQuestion,
  type DaemonEvent,
  type DeviceRecord,
  type Proposal,
  type DisplayHost,
  type DisplayRequest,
  type PendingApproval,
  type SessionHost,
  workDraftOf,
} from '@memnox/core';
import { ruleDraftOf } from '../protect/rule-scope';
import { liveHost } from '../session-tools/live-host';
import { processAlive } from '../session-tools/sessions-tool';
import { displayName, readNames, type AgentNames } from '../agents/names';
import { withEvents } from '../event-store';
import { answerOnOf, answeringPhone } from '../remote/answer-on';
import { NewsTold } from './news-told';

/**
 * What is waiting on a person, read from the files other processes write, since a held
 * call may be raised by any seam and a proposal by any operator.
 */
export class WaitingFeed {
  private readonly pending: PendingApprovals;
  private readonly proposals: Proposals;
  private readonly displays: DisplayRequests;
  /** The news the Mac app already heard, so reopening it never says it again. */
  readonly told: NewsTold;
  /** A finished turn's summary by subject, since the feed is read every few seconds and the turn is over. */
  private readonly summaries = new Map<string, DaemonEvent>();

  constructor(private readonly home: string) {
    this.pending = new PendingApprovals(home);
    this.proposals = new Proposals(home);
    this.displays = new DisplayRequests(home);
    this.told = new NewsTold(home);
  }

  /** What the app is told: everything waiting, then anything the person asked to see. */
  async everything(moment: string): Promise<DaemonEvent[]> {
    const shown = await Promise.all(
      (await this.displays.open(moment)).map((each) => this.displayEvent(each)),
    );
    return [...(await this.current(moment)), ...shown];
  }

  /** A window to bring forward or a card to show, with where the session runs. */
  private async displayEvent(request: DisplayRequest): Promise<DaemonEvent> {
    const recorded = await new SessionHosts(this.home).read(request.sessionId);
    // Its terminal as it is now; a session whose process has ended has no window to bring forward.
    const host = seenIn(recorded === null ? null : liveHost(recorded), request);
    return {
      kind: DAEMON_EVENT.SHOW,
      subject: request.id,
      agent: request.agent,
      summary: request.text ?? request.title,
      at: request.requestedAt,
      expiresAt: request.expiresAt,
      display: request.display,
      title: request.title,
      sessionId: request.sessionId,
      ...(request.files === undefined ? {} : { files: request.files }),
      ...(request.excerpt === undefined ? {} : { excerpt: request.excerpt }),
      ...(request.pages === undefined ? {} : { pages: request.pages }),
      ...scanOf(request),
      ...(request.trace === undefined ? {} : { trace: request.trace }),
      ...(request.signIn === undefined ? {} : { signIn: request.signIn }),
      ...appOf(request),
      ...(request.via === undefined ? {} : { via: request.via }),
      ...(host === null
        ? requestedHost(request)
        : {
            host: {
              ...(host.app === undefined ? {} : { app: host.app }),
              ...(host.appPath === undefined ? {} : { appPath: host.appPath }),
              ...(host.tty === undefined ? {} : { tty: host.tty }),
              // Only the agent's own id: a guess opens a new conversation in the panel instead of this one.
              ...conversationOf(host),
              // The show tool resolved the checkout the person has open, which beats the agent's own folder.
              ...((request.cwd ?? host.cwd) === undefined
                ? {}
                : { cwd: request.cwd ?? host.cwd }),
              ...(request.marks === undefined ? {} : { marks: request.marks }),
            },
          }),
    };
  }

  /**
   * One held call while it is still unanswered and in time, read by its id rather than from the
   * list, so a call the app was already told about is briefed even where its session's host is
   * no longer found, and the app hears a stale question only when nobody can answer it.
   */
  async held(subject: string, moment: string): Promise<DaemonEvent | null> {
    const pending = await this.pending.read(subject);
    if (pending === null || pending.answer !== undefined || pending.expiresAt <= moment) {
      return null;
    }
    return this.heldEvent(pending, await readNames(this.home));
  }

  /** Everything still answerable, held calls first because an agent is blocked on each. */
  async current(moment: string): Promise<DaemonEvent[]> {
    const names = await readNames(this.home);
    const hosts = new SessionHosts(this.home);
    // Read once per look, so every yes in it names the same phone.
    const devices = await new Devices(this.home).all().catch((): DeviceRecord[] => []);
    const open = async (sessionId: string): Promise<boolean> =>
      !(await closed(hosts, sessionId));
    const waiting = await keepIf(
      (await this.pending.list(moment)).filter((each) => each.answer === undefined),
      (each) => open(each.request.sessionId),
    );
    const held = await Promise.all(
      waiting.map((each) => this.heldEvent(each, names, devices)),
    );
    const questions = await keepIf(
      await new AgentQuestions(this.home).open(moment),
      (each) => open(each.sessionId),
    );
    const asking = await Promise.all(
      questions.map((each) => this.questionEvent(each, names)),
    );
    const inside = new Set(
      waiting
        .filter((each) => each.request.withinSession === true)
        .map((each) => each.id),
    );
    const proposed = (await this.proposals.open(moment)).map((each) =>
      proposalEvent(each, inside, devices),
    );
    const posted = await this.posted(moment, names, open);
    return [...held, ...asking, ...posted, ...proposed];
  }

  /**
   * What a person away should hear that is not a question: a session the breaker stopped, one
   * struggling, and a long turn that finished and is waiting on them. Each has a stable subject,
   * so a phone is woken once for it and not on every look.
   */
  private async posted(
    moment: string,
    names: AgentNames,
    open: (sessionId: string) => Promise<boolean>,
  ): Promise<DaemonEvent[]> {
    const pauses = await keepIf(
      (await new SessionPauses(this.home).all()).filter(
        (each) => each.resumedAt === undefined,
      ),
      (each) => open(each.sessionId),
    );
    const struggling = await keepIf(
      await new SessionPosts(this.home).open(moment),
      (each) => open(each.sessionId),
    );
    return [
      ...pauses.map((pause) => ({
        kind: DAEMON_EVENT.PAUSED,
        subject: pause.sessionId,
        agent: UNNAMED_AGENT,
        summary: describePause(pause),
        at: pause.pausedAt,
        sessionId: pause.sessionId,
      })),
      ...struggling.map((post) => postEvent(post, nameOf(names, post.agent))),
      ...(await this.finished(moment, names)),
    ];
  }

  /** Long turns that handed back while nobody answered, told with what they came to. */
  private async finished(moment: string, names: AgentNames): Promise<DaemonEvent[]> {
    const events: DaemonEvent[] = [];
    for (const turn of await new SessionTurns(this.home).all()) {
      const span = awayTurn(turn, moment);
      if (span === null) continue;
      const subject = noticeSubject(NOTICE_KIND.FINISHED, turn.sessionId, span.endedAt);
      const known = this.summaries.get(subject);
      if (known !== undefined) {
        events.push(known);
        continue;
      }
      const agentName = nameOf(names, turn.agent);
      const rows = await withEvents(this.home, (store) =>
        store.query({ sessionId: turn.sessionId, limit: LEDGER_SESSION_LIMIT }),
      ).catch(() => []);
      const away = describeAwayTurn(agentName, span, rows, moment);
      const event: DaemonEvent = {
        kind: DAEMON_EVENT.NOTICE,
        notice: NOTICE_KIND.FINISHED,
        subject,
        agent: turn.agent,
        agentName,
        summary: away.summary,
        run: away.run,
        at: span.endedAt,
        sessionId: turn.sessionId,
      };
      this.summaries.set(subject, event);
      events.push(event);
    }
    // Only what is still news is kept, so the cache is never older than the turns it describes.
    const current = new Set(events.map((event) => event.subject));
    for (const subject of [...this.summaries.keys()]) {
      if (!current.has(subject)) this.summaries.delete(subject);
    }
    return events;
  }

  /** An agent's own question, said as news so the voice reads it out and listens for the answer. */
  private async questionEvent(
    question: AgentQuestion,
    names: AgentNames,
  ): Promise<DaemonEvent> {
    const [task, host] = await Promise.all([
      new SessionTasks(this.home).read(question.sessionId),
      new SessionHosts(this.home).read(question.sessionId),
    ]);
    const agentName = nameOf(names, question.agent);
    return {
      kind: DAEMON_EVENT.NOTICE,
      notice: NOTICE_KIND.QUESTION,
      subject: question.id,
      agent: question.agent,
      agentName,
      summary: `${agentName} is asking you: ${question.questions[0]?.question ?? 'a question'}`,
      at: question.askedAt,
      expiresAt: question.expiresAt,
      sessionId: question.sessionId,
      questions: question.questions,
      ...(question.answers === undefined ? {} : { answers: question.answers }),
      ...(task === null ? {} : { task: task.statement }),
      ...(task?.latestAsk === undefined ? {} : { lastAsk: task.latestAsk }),
      ...(host?.cwd === undefined ? {} : { place: basename(host.cwd) }),
    };
  }

  /** A held call with what a person needs to hear about it: who, where, doing what, and why. */
  private async heldEvent(
    held: PendingApproval,
    names: AgentNames,
    devices: readonly DeviceRecord[] = [],
  ): Promise<DaemonEvent> {
    const { request } = held;
    const [task, host] = await Promise.all([
      new SessionTasks(this.home).read(request.sessionId),
      new SessionHosts(this.home).read(request.sessionId),
    ]);
    // The same words the session and the DM use, so a question reads alike wherever it lands.
    const plain = held.plain ?? plainAsk(request, task?.statement);
    return {
      kind: DAEMON_EVENT.HELD,
      subject: held.id,
      agent: request.agent,
      summary: `${request.agent} wants to ${describeHeldCall(request)}`,
      at: held.askedAt,
      expiresAt: held.expiresAt,
      agentName: nameOf(names, request.agent),
      what: plain.doing ?? describeHeldCall(request),
      why: plain.why,
      sessionId: request.sessionId,
      ...(task === null ? {} : { task: task.statement }),
      ...(task?.latestAsk === undefined ? {} : { lastAsk: task.latestAsk }),
      ...(host?.cwd === undefined ? {} : { place: basename(host.cwd) }),
      ...(request.withinSession === true ? { withinSession: true } : {}),
      ...answerOnOf(answeringPhone(devices, REMOTE_CAPABILITY.ANSWER)),
    };
  }
}

/**
 * An agent's own conversation id, which is a UUID, never Memnox's own `ses_` key for it. Outside
 * `memnox run` the session is keyed by that very id, so it is the session id itself.
 */
export function conversationOf(host: Pick<SessionHost, 'sessionId' | 'agentSession'>): {
  conversation?: string;
} {
  const id = host.agentSession ?? host.sessionId;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? { conversation: id }
    : {};
}

/** A struggling session or one asking in its terminal, said as news so the person hears it away from the screen. */
function postEvent(post: SessionPost, agentName: string): DaemonEvent {
  return {
    kind: DAEMON_EVENT.NOTICE,
    notice: post.kind === POST_KIND.ASKING ? NOTICE_KIND.ASKING : NOTICE_KIND.STRUGGLING,
    subject: post.id,
    agent: post.agent,
    agentName,
    summary: post.summary,
    at: post.at,
    expiresAt: post.expiresAt,
    sessionId: post.sessionId,
  };
}

/** A question an agent asks in its terminal lives in this feed rather than the broadcast, so it is briefed from here. */
export function askingIn(event: DaemonEvent | undefined): DaemonEvent | null {
  return event !== undefined && event.notice === NOTICE_KIND.ASKING ? event : null;
}

/** The name the person gave the agent, or its product name made readable. */
function nameOf(names: AgentNames, agent: string): string {
  const id = agent.startsWith(AGENT_ID_PREFIX) ? agent : `${AGENT_ID_PREFIX}${agent}`;
  return displayName(names, { id, kind: agent });
}

/** A session the person closed, or whose process is gone, has nobody left to answer for. */
async function closed(hosts: SessionHosts, sessionId: string): Promise<boolean> {
  const host = await hosts.read(sessionId);
  if (host === null) return false;
  return host.endedAt !== undefined || !processAlive(host.pid);
}

async function keepIf<T>(
  items: readonly T[],
  keep: (item: T) => Promise<boolean>,
): Promise<T[]> {
  const kept = await Promise.all(items.map(keep));
  return items.filter((_, index) => kept[index]);
}

/** A pane is seen in the terminal its multiplexer shows it in, which is the tab to bring forward. */
function seenIn(live: SessionHost | null, request: DisplayRequest): SessionHost | null {
  if (live === null || request.shownIn === undefined) return live;
  const { tty: _inner, ...rest } = live;
  return { ...rest, ...request.shownIn };
}

/**
 * Where to show it when no session runs there yet: the folder, the app an APP start opens, and the
 * tab a run noted before its agent's first hook, which is where that agent asks its first question.
 */
function requestedHost(request: DisplayRequest): { host?: DisplayHost } {
  if (
    request.cwd === undefined &&
    request.appPath === undefined &&
    request.tty === undefined
  )
    return {};
  return {
    host: {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.appPath === undefined ? {} : { appPath: request.appPath }),
      ...(request.tty === undefined ? {} : { tty: request.tty }),
      ...(request.marks === undefined ? {} : { marks: request.marks }),
    },
  };
}

/** On an APP start, the app's links and what it reads as it opens. */
function appOf(request: DisplayRequest): Pick<DaemonEvent, 'app'> {
  if (request.links === undefined) return {};
  return {
    app: {
      links: request.links,
      ...(request.env === undefined ? {} : { env: request.env }),
    },
  };
}

/** Said once something stops waiting, so a question answered elsewhere stops being asked out loud. */
export function settled(subject: string, at: string): DaemonEvent {
  return {
    kind: DAEMON_EVENT.SETTLED,
    subject,
    agent: UNNAMED_AGENT,
    summary: 'no longer waiting on you',
    at,
  };
}

/** One open proposal as the event every surface shows; `inside` holds the held calls within a session. */
function proposalEvent(
  each: Proposal,
  inside: ReadonlySet<string>,
  devices: readonly DeviceRecord[],
): DaemonEvent {
  // A rule carries itself and where it could hold, so the Mac asks where before Touch ID.
  const rule = ruleDraftOf(each);
  // A yes to a held call that stays in its repository needs no fingerprint, by voice as by hand.
  const within =
    each.change.kind === PROPOSAL_KIND.ANSWER && inside.has(each.change.pendingId);
  return {
    kind: DAEMON_EVENT.PROPOSAL,
    subject: each.id,
    agent: each.proposedBy,
    summary: each.rationale,
    at: each.proposedAt,
    expiresAt: each.expiresAt,
    ...(rule === undefined ? {} : { rule }),
    ...(within ? { withinSession: true } : {}),
    ...teamAnswerOf(each),
    ...workDraftFor(each),
    ...phoneOf(each, devices),
  };
}

/**
 * The phone a proposal waits on. A Mac proposal belongs to the phone whose ask raised it, named as its
 * origin so that phone signs it whether or not it still holds the voice; any other goes to a paired phone.
 */
function phoneOf(
  proposal: Proposal,
  devices: readonly DeviceRecord[],
): Pick<DaemonEvent, 'origin' | 'answerOn'> {
  const change = proposal.change;
  const asker = change.kind === PROPOSAL_KIND.MAC ? change.deviceId : undefined;
  return {
    ...(asker === undefined ? {} : { origin: { deviceId: asker } }),
    ...answerOnOf(answeringPhone(devices, proposalCapability(change), asker)),
  };
}

/** Something going out in the person's name, drawn on the Mac the way its tool draws it. */
function workDraftFor(proposal: Proposal): Pick<DaemonEvent, 'work' | 'claim'> {
  const change = proposal.change;
  // Answered from the signed in pill in the notch, so the Mac never declines it as unasked.
  if (change.kind === PROPOSAL_KIND.ACCOUNT)
    return { claim: { toolkit: change.toolkit, label: change.label } };
  if (change.kind !== PROPOSAL_KIND.WORK) return {};
  const args = argumentsOf(change.argumentsText);
  return {
    work: workDraftOf(change.toolkit, change.tool, args, {
      ...(change.account === undefined ? {} : { account: change.account }),
      ...(change.toName === undefined ? {} : { toName: change.toName }),
    }),
  };
}

function argumentsOf(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>) // a plain object, checked above
      : {};
  } catch {
    // Checked when it was proposed; a card with no fields still names the tool.
    return {};
  }
}

/** A team's question answered by voice, named on the proposal so the device that asked carries it out. */
function teamAnswerOf(proposal: Proposal): Pick<DaemonEvent, 'teamAnswer'> {
  const change = proposal.change;
  if (change.kind !== PROPOSAL_KIND.TEAM) return {};
  return {
    teamAnswer: { callId: change.callId, answer: change.answer, label: change.label },
  };
}

/** On AGENTS, the agents and the machine's count of what they can change. */
function scanOf(request: DisplayRequest): Pick<DaemonEvent, 'agents' | 'capabilities'> {
  return {
    ...(request.agents === undefined ? {} : { agents: request.agents }),
    ...(request.capabilities === undefined ? {} : { capabilities: request.capabilities }),
  };
}
