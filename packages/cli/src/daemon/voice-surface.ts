import {
  AgentQuestions,
  isAgentQuestionId,
  DAEMON_EVENT,
  DAEMON_METHOD,
  BRIEFING,
  describePause,
  SessionPauses,
  UNNAMED_AGENT,
  type DaemonEvent,
  type DaemonRequest,
  clearVoiceListening,
  type DaemonResponse,
} from '@memnox/core';
import type { Brain } from '../operator/brain';
import { howToAddress, keepOwner } from '../operator/owner';
import {
  backBrief,
  heldBrief,
  questionBrief,
  noticeBrief,
  pausedBrief,
} from '../operator/voice-prompts';
import { isWordsMethod, wordsAnswer } from '../operator/recognizer-words';
import { isHomeMethod } from './home-answer';
import { answerHome } from './home-status';
import { AddressLimit } from './address-limit';
import { deliveredAnswer, phoneDeliveredAnswer, seenAnswer } from './voice-deliveries';
import { SEEN } from './done-lines';
import { BrainTurns } from './brain-turns';
import {
  answerVoiceAgents,
  isVoiceAgentMethod,
  type VoiceAgentRoster,
} from './voice-agent-calls';
import type { RemotePrincipal } from './confirm';
import { answerWaiting } from './confirm-question';
import { followUpAnswer, followUpDeps } from './follow-up';
import { answerMachine, isMachineMethod, type MachineSignIns } from './machine-calls';
import { answerConnectionCall, isConnectionsMethod } from './connection-calls';
import { answerPerson, isPersonMethod, type PersonSignIns } from './person-calls';
export { isVoiceMethod } from './voice-methods';
import { NoticeWatcher } from './notice-watch';
import { RecentExchanges } from './recall';
import { streamTurn } from './stream-turn';
import { VoiceAsk } from './voice-ask';
import { momentContext } from './ask-context';
import {
  heardRemotely,
  markNeedsMac,
  noteTold,
  OriginRouter,
  sendWaiting,
  type RouterDeps,
} from './origin-routing';
import { filesListAnswer } from './folder-listing';
import { markListeningFor } from './voice-listening';
import { speak, type Render } from './kokoro-speech';
import { mirrorFor } from './phone-turn';
import { HeardByBroadcast } from './heard-by-broadcast';
import { askAgain } from './news-told';
import { VoiceHold, voiceOnNotice } from '../remote/voice-hold';
import { SessionViews } from './session-view';
import { answerPolish, isPolishMethod } from './polish-calls';
import { answerRule, isRuleMethod } from './rule-calls';
import { write, type Peer } from './socket-write';
import { askingIn, WaitingFeed } from './waiting-feed';
import { BRAIN_IDLE_MS, FEED_INTERVAL_MS, NOTICE_INTERVAL_MS } from './voice.constants';
import {
  locateAnswer,
  macSpansAnswer,
  registerKeyAnswer,
  sessionViewAnswer,
} from './voice-lookups';

/**
 * The daemon's side facing a person rather than an agent: what is waiting on them, their
 * answers, and their questions to their own brain. Kept apart from the hot path that rules
 * on every command, since none of it has that latency budget.
 */

interface VoiceDeps {
  home: string;
  now: () => string;
  log: (message: string) => void;
  feedIntervalMs?: number;
  noticeIntervalMs?: number;
  brain?: () => Brain;
  brainIdleMs?: number;
  voiceAgents?: VoiceAgentRoster;
  /** The daemon's own person sign in, driven from the Mac app's Account page. */
  person?: PersonSignIns;
  /** This machine's connection to its workspace, driven from the same page. */
  machine?: MachineSignIns;
  /** Where SPEAK renders a line: the Mac app's Kokoro, unless a test stands in for it. */
  render?: Render;
  /** The paired phones' side: whether one drives the Mac, and a line to one's live session. */
  remote?: Pick<RouterDeps, 'driving' | 'tell'>;
}

export class VoiceSurface {
  /** Each subscriber with what it has already been told, so nobody hears a thing twice or never. */
  private readonly subscribers = new Map<Peer, Set<string>>();
  private readonly heard = new HeardByBroadcast();
  /** Subscribers that are paired phones, by device, which never hear the Mac's own shows. */
  private readonly phones = new Map<Peer, string>();
  private readonly router: OriginRouter;
  /** Which phone speaks right now, so the Mac stays silent while it does; the endpoint tells it of drives and phones gone. */
  readonly hold: VoiceHold;
  private readonly feed: WaitingFeed;
  private feedTimer: ReturnType<typeof setInterval> | null = null;
  private noticeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly notices: NoticeWatcher;
  private readonly turns: BrainTurns | null;
  private readonly views: SessionViews;
  private readonly exchanges: RecentExchanges;
  private readonly address: AddressLimit;
  /** Their questions, and the guess at each started while they pause. */
  private readonly asking: VoiceAsk | null;

  constructor(private readonly deps: VoiceDeps) {
    this.feed = new WaitingFeed(deps.home);
    this.notices = new NoticeWatcher(deps.home, deps.now());
    this.views = new SessionViews(deps.home);
    this.exchanges = new RecentExchanges(deps.home);
    this.address = new AddressLimit(deps.home);
    // Told to the Mac app alone, since the phone knows it holds the voice and the relay never carries it.
    this.hold = new VoiceHold(deps.now, (voiceOn) => {
      const event = voiceOnNotice(voiceOn, deps.now());
      for (const peer of this.macPeers()) write(peer, { id: 0, ok: true, event });
      // Back on the Mac, so what waits on an answer and was only shown there is said there.
      if (voiceOn.holding) return;
      const told = this.macPeers().map((peer) => this.subscribers.get(peer));
      void askAgain(this.feed, deps.now(), told).then(() => this.pushWaiting());
    });
    this.router = new OriginRouter({
      home: deps.home,
      now: deps.now,
      driving: (deviceId) => deps.remote?.driving(deviceId) ?? false,
      tell: (deviceId, response) => deps.remote?.tell(deviceId, response) ?? false,
      listening: (deviceId) => [...this.phones.values()].includes(deviceId),
      stamp: (event) => this.hold.stamp(event),
    });
    this.turns =
      deps.brain === undefined
        ? null
        : new BrainTurns(deps.brain, deps.brainIdleMs ?? BRAIN_IDLE_MS);
    this.asking =
      this.turns === null
        ? null
        : new VoiceAsk({
            home: deps.home,
            now: deps.now,
            turns: this.turns,
            views: this.views,
            exchanges: this.exchanges,
            address: this.address,
            log: deps.log,
          });
  }

  /** A request from the Mac app, or from a paired phone whose principal the remote endpoint proved. */
  async respond(
    socket: Peer,
    request: DaemonRequest,
    principal?: RemotePrincipal,
  ): Promise<void> {
    // Kept for the next time the brain starts, so it speaks to them by the name they chose.
    if (request.owner !== undefined)
      await keepOwner(this.deps.home, request.owner).catch(() => undefined);
    if (request.method === DAEMON_METHOD.BRIEF) return this.brief(socket, request);
    if (request.method === DAEMON_METHOD.WARM) {
      // Answered at once and warmed behind it, since the person is still talking.
      write(socket, { id: request.id, ok: true, outcome: 'warming' });
      void this.turns?.warm();
      // Sent as the Mac answers their call, which already used the title or the name.
      void this.address
        .names()
        .then((forms) => this.address.noteCalled(forms, this.deps.now()))
        .catch(() => undefined);
      return;
    }
    if (request.method === DAEMON_METHOD.SUBSCRIBE)
      return this.subscribe(socket, request.id, principal);
    if (request.method === DAEMON_METHOD.ASK) return this.ask(socket, request, principal);
    if (request.method === DAEMON_METHOD.CANCEL) {
      const outcome = this.turns?.cancel() === true ? 'cancelled' : 'nothing to cancel';
      return write(socket, { id: request.id, ok: true, outcome });
    }
    if (request.method === DAEMON_METHOD.SPEAK) return speak(socket, request, this.deps);
    const response = await this.answer(request, principal).catch(
      (err: unknown): DaemonResponse => ({
        id: request.id,
        ok: false,
        error: String(err),
      }),
    );
    write(socket, response);
  }

  broadcast(event: DaemonEvent): void {
    const stamped = this.hold.stamp(event);
    for (const socket of this.subscribers.keys()) {
      if (this.phones.has(socket) && !heardRemotely(event)) continue;
      write(socket, { id: 0, ok: true, event: stamped });
      this.heard.note(socket, event.subject);
    }
  }

  drop(socket: Peer): void {
    const deviceId = this.phones.get(socket);
    if (deviceId !== undefined) this.hold.unsubscribed(deviceId);
    this.phones.delete(socket);
    if (!this.subscribers.delete(socket) || this.subscribers.size > 0) return;
    void clearVoiceListening(this.deps.home).catch(() => undefined);
  }

  close(): void {
    if (this.feedTimer !== null) clearInterval(this.feedTimer);
    this.feedTimer = null;
    if (this.noticeTimer !== null) clearInterval(this.noticeTimer);
    this.noticeTimer = null;
    this.notices.close();
    this.hold.close();
    for (const socket of this.subscribers.keys()) socket.destroy();
    this.subscribers.clear();
    void clearVoiceListening(this.deps.home).catch(() => undefined);
    this.turns?.close();
  }

  private async answer(
    request: DaemonRequest,
    principal?: RemotePrincipal,
  ): Promise<DaemonResponse> {
    const feed = this.feed;
    if (isPolishMethod(request.method)) return answerPolish(this.deps.home, request);
    if (isRuleMethod(request.method))
      return answerRule(this.deps.home, request, this.deps.now());
    if (request.method === DAEMON_METHOD.LOCATE)
      return locateAnswer(this.deps.home, request);
    if (request.method === DAEMON_METHOD.SESSION_VIEW)
      return sessionViewAnswer(this.views, request);
    if (isHomeMethod(request.method))
      return answerHome(this.deps.home, request, this.views);
    if (request.method === DAEMON_METHOD.SESSIONS_LIST) {
      return { id: request.id, ok: true, sessions: await this.views.list() };
    }
    if (isPersonMethod(request.method)) return answerPerson(request, this.deps.person);
    if (isMachineMethod(request.method)) return answerMachine(request, this.deps.machine);
    if (isConnectionsMethod(request.method))
      return answerConnectionCall(request, this.deps.home, principal !== undefined);
    if (isWordsMethod(request.method)) {
      return wordsAnswer(this.deps.home, request, this.deps.now());
    }
    if (request.method === DAEMON_METHOD.WAITING) {
      return { id: request.id, ok: true, waiting: await feed.current(this.deps.now()) };
    }
    if (request.method === DAEMON_METHOD.REGISTER_KEY)
      return registerKeyAnswer(this.deps.home, request, this.deps.now());
    if (request.method === DAEMON_METHOD.DELIVERED) {
      if (principal !== undefined) {
        const sentToIt = this.router.sentTo(request.subject ?? '', principal.device.id);
        const phone = { name: principal.device.name, sentToIt };
        return phoneDeliveredAnswer(this.deps.home, request, this.deps.now(), phone);
      }
      await this.router.delivered(request.subject ?? '', request.answer ?? '');
      return deliveredAnswer(this.deps.home, request, this.deps.now());
    }
    if (request.method === DAEMON_METHOD.SEEN) {
      await this.router.delivered(request.subject ?? '', SEEN);
      return seenAnswer(this.deps.home, request);
    }
    if (request.method === DAEMON_METHOD.TRACE)
      return macSpansAnswer(this.deps.home, request);
    if (request.method === DAEMON_METHOD.FILES_LIST)
      return filesListAnswer(this.deps.home, request);
    if (isVoiceAgentMethod(request.method)) {
      return answerVoiceAgents(request, this.deps.voiceAgents);
    }
    if (request.method === DAEMON_METHOD.FOLLOW_UP)
      return followUpAnswer(
        request,
        followUpDeps(this.deps, this.views, this.router),
        principal,
      );
    return this.confirm(request, principal);
  }

  /** A person's answer; a Mac proposal a phone signed is shown on the Mac once it counts. */
  private async confirm(
    request: DaemonRequest,
    principal?: RemotePrincipal,
  ): Promise<DaemonResponse> {
    const result = await answerWaiting(
      this.deps.home,
      request,
      this.deps.now(),
      principal,
    );
    if (!result.ok) {
      const refused =
        result.refused === true ? { outcome: 'refused', reason: result.error } : {};
      return { id: request.id, ok: false, error: result.error, ...refused };
    }
    if (result.release !== undefined) {
      await this.router.release(
        result.release.event,
        result.release.deviceId,
        this.macPeers(),
      );
    }
    return { id: request.id, ok: true, outcome: result.outcome };
  }

  /** Something that happened, told by the brain in its own words, streamed like an answer. */
  private async brief(socket: Peer, request: DaemonRequest): Promise<void> {
    const turns = this.turns;
    const prompt = await this.briefFor(request);
    if (turns === null || prompt === null) {
      const error = turns === null ? 'no brain is configured' : 'nothing to brief about';
      write(socket, { id: request.id, ok: false, error });
      return;
    }
    // The same stream as an answer, so an unasked brief is never said twice or with a reminder in it.
    const names = await this.address.names();
    const turn = await streamTurn(
      turns,
      prompt,
      (chunk) => write(socket, { id: request.id, ok: true, chunk }),
      this.address.unsaid(names, this.deps.now()),
    );
    this.address.noteSaid(turn.answered, names, this.deps.now());
    // A brief often ends in an offer, which the next "yes" has to find even after a fresh start.
    await this.exchanges.add({
      at: this.deps.now(),
      said: `(told unasked, about ${request.briefing ?? 'news'})`,
      unasked: true,
      answered: turn.answered,
    });
  }

  /** An agent's question, read out with its choices, or nothing once it is answered or gone. */
  private async questionFor(subject: string, agentName?: string): Promise<string | null> {
    const question = await new AgentQuestions(this.deps.home).read(subject);
    if (question === null) return null;
    const address = await howToAddress(this.deps.home);
    return questionBrief(question, agentName ?? question.agent, address);
  }

  private async briefFor(request: DaemonRequest): Promise<string | null> {
    if (request.briefing === BRIEFING.BACK) {
      if (request.since === undefined) return null;
      // Coming back to the Mac is not a call to Memnox, so it speaks only when something waits on them.
      if ((await this.feed.current(this.deps.now())).length === 0) return null;
      const now = this.deps.now();
      const spoke = (await this.exchanges.read(now))
        .filter((each) => each.unasked !== true)
        .at(-1)?.at;
      return `${momentContext(new Date(now), spoke)}\n${backBrief(request.since)}`;
    }
    const waiting = await this.feed.current(this.deps.now());
    const event = waiting.find((each) => each.subject === request.subject);
    if (request.briefing === BRIEFING.NOTICE && isAgentQuestionId(request.subject ?? ''))
      return this.questionFor(request.subject ?? '', event?.agentName);
    if (request.briefing === BRIEFING.NOTICE && request.subject !== undefined) {
      const notice = this.notices.recent(request.subject) ?? askingIn(event);
      if (notice === null) return null;
      return noticeBrief(notice, await howToAddress(this.deps.home));
    }
    if (request.briefing === BRIEFING.HELD && request.subject !== undefined) {
      const held = event ?? (await this.feed.held(request.subject, this.deps.now()));
      return held === null ? null : heldBrief(held, await howToAddress(this.deps.home));
    }
    if (request.briefing === BRIEFING.PAUSED && request.subject !== undefined) {
      const pause = await new SessionPauses(this.deps.home).read(request.subject);
      return pause === null
        ? null
        : pausedBrief({
            kind: DAEMON_EVENT.PAUSED,
            subject: pause.sessionId,
            agent: UNNAMED_AGENT,
            summary: describePause(pause),
            at: pause.pausedAt,
          });
    }
    return null;
  }

  /** What the person said, answered by their own brain one chunk per line, back to whoever asked. */
  private async ask(
    socket: Peer,
    request: DaemonRequest,
    principal?: RemotePrincipal,
  ): Promise<void> {
    const said = request.said?.trim() ?? '';
    if (said === '' || this.asking === null) {
      const error = said === '' ? 'ask needs what was said' : 'no brain is configured';
      write(socket, { id: request.id, ok: false, error });
      return;
    }
    const deviceId = principal?.device.id;
    // Set from the session that asked, never from what a client wrote.
    const { origin: _client, ...rest } = request;
    const asked = deviceId === undefined ? rest : { ...rest, origin: { deviceId } };
    const ask = this.router.asked(deviceId, this.deps.now());
    if (deviceId !== undefined) this.startFeed();
    if (principal !== undefined) this.hold.began(principal.device);
    else this.hold.macTookBack();
    const { now } = this.deps;
    const mirror = mirrorFor(principal, request, { mac: () => this.macPeers(), now });
    try {
      await this.asking.ask(socket, asked, said, mirror?.chunk.bind(mirror));
    } finally {
      ask.endedAt = this.deps.now();
      mirror?.end();
      if (deviceId !== undefined) this.hold.ended(deviceId);
    }
  }

  /** The Mac app's own subscriptions, where a show only the Mac can do is sent. */
  private macPeers(): Peer[] {
    return [...this.subscribers.keys()].filter((peer) => !this.phones.has(peer));
  }

  /** Everything already waiting first, then each new thing as it appears. */
  private async subscribe(
    socket: Peer,
    id: number,
    principal?: RemotePrincipal,
  ): Promise<void> {
    const told = new Set<string>();
    this.subscribers.set(socket, told);
    // A live stream means its app is open, so the phone holds the voice until the stream ends.
    if (principal !== undefined && !this.phones.has(socket)) {
      this.phones.set(socket, principal.device.id);
      this.hold.subscribed(principal.device);
    } else if (principal !== undefined) this.hold.renewed(principal.device.id);
    write(socket, { id, ok: true });
    await markListeningFor(this.deps.home, this.deps.now(), principal);
    // The Mac app is listening, so the first question should meet a brain that is already up.
    void this.turns?.warm();
    const waiting = await this.feed.everything(this.deps.now());
    waiting.forEach((event) => noteTold(told, event));
    for (const event of await this.feed.told.firstHeard(waiting, principal !== undefined))
      write(socket, { id, ok: true, event: this.hold.stamp(markNeedsMac(event)) });
    this.watchNotices();
    this.startFeed();
  }

  /** Polls for what is waiting while somebody listens or a phone's question may still raise a show. */
  private startFeed(): void {
    if (this.feedTimer !== null) return;
    this.feedTimer = setInterval(
      () => void this.pushWaiting(),
      this.deps.feedIntervalMs ?? FEED_INTERVAL_MS,
    );
    // A subscriber is not a reason to keep a daemon alive that was asked to stop.
    this.feedTimer.unref();
  }

  /** Reads the ledger for news every few seconds while somebody is listening. */
  private watchNotices(): void {
    if (this.noticeTimer !== null) return;
    this.notices.followCollisions((event) => this.broadcast(event), this.deps.now);
    this.noticeTimer = setInterval(() => {
      if (this.subscribers.size === 0) return;
      this.notices
        .look(this.deps.now())
        .then((events) => events.forEach((event) => this.broadcast(event)))
        .catch((err: unknown) =>
          this.deps.log(`could not look for news: ${String(err)}`),
        );
    }, this.deps.noticeIntervalMs ?? NOTICE_INTERVAL_MS);
    this.noticeTimer.unref();
  }

  private async pushWaiting(): Promise<void> {
    if (this.subscribers.size === 0 && !this.router.active()) return;
    try {
      const waiting = (await this.feed.everything(this.deps.now())).map(markNeedsMac);
      // A phone's shows go first, so the Mac app is never sent the raw one as well.
      const claimed = await this.router.claim(waiting, this.macPeers());
      if (this.macPeers().length > 0) await this.feed.told.keep(waiting);
      this.heard.fold(this.subscribers, waiting);
      sendWaiting(this.subscribers, waiting, {
        claimed,
        now: this.deps.now(),
        phoneOf: (socket) => this.phones.get(socket),
        originOf: (event) => this.router.originFor(event),
        stamp: (event) => this.hold.stamp(event),
      });
    } catch (err) {
      this.deps.log(`could not read what is waiting: ${String(err)}`);
    }
  }
}
