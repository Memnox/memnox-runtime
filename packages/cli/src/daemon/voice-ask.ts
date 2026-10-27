import {
  AgentQuestions,
  ASK_INTENT,
  DAEMON_EVENT,
  VoiceFocusStore,
  type DaemonAskChunk,
  type DaemonRequest,
  type TeamCallBrief,
  type SessionView,
} from '@memnox/core';
import type { AddressLimit } from './address-limit';
import { answeredContext, answeredSince } from './answered-drafts';
import {
  askContext,
  foldersContext,
  heardWordsContext,
  profileContext,
  lookingAtContext,
  openSessionContext,
  phoneContext,
  windowContext,
  FINISHED_NOTE,
  heldCallsContext,
  momentContext,
  GREETED_NOTE,
  RESUME_NOTE,
  RULE_NOTE,
  questionsContext,
} from './ask-context';
import { BRAIN_CHUNK } from '../operator/brain';
import { noteAskedFrom } from './asked-from';
import { folderUses } from '../operator/folders';
import { readHeardWords } from '../operator/heard-words';
import { noteOffered, readProfile } from '../operator/profile';
import type { BrainTurns } from './brain-turns';
import {
  lastAnswered,
  recallContext,
  waitingOnYes,
  type RecentExchanges,
} from './recall';
import type { SessionViews } from './session-view';
import { write, type Peer } from './socket-write';
import { GUESS_STATE, noteGuess, type GuessState } from './guess-state';
import { OVERTAKEN_NOTE, Speculation, type GuessSeams } from './speculation';
import { streamTurn, withoutHolds } from './stream-turn';
import { VoiceTurnTrace } from '../trace/voice-trace';
import { WaitingFeed } from './waiting-feed';
import { keepTeamCalls, teamCallsContext } from './team-calls-store';

/**
 * What the person asks, answered by their own brain one chunk per line, and the guess at it
 * started while they pause. Kept apart from the rest of the voice, since this is the path whose
 * every millisecond is heard.
 */

/** Long enough to cover the rest of a sentence said after a hold, short of a new question. */
const HELD_WITHIN_MS = 60_000;

/**
 * How long a context built for a guess is used again for the words that follow it, within one
 * sentence said with pauses: building one reads every session, and doing it twice made an answer wait.
 */
const CONTEXT_REUSE_MS = 5_000;

/** Said ahead of the next words when a reply was cut off after it had already done something. */
export function actedNote(tools: readonly string[]): string {
  // Told what to check rather than that it ran, since a call made while they were still speaking is held back and does nothing.
  return `[Memnox, not the person] Your last reply was cut off when they spoke, after it reached for ${tools.join(', ')}. Read that call's own result in this conversation: when it says it was done, such as started or sent, never repeat it for the same request; when it says nothing was done, or there is no result, do it now. Never tell them something was already done unless a result said so, and anything new their words ask for, even something similar, is done at once.`;
}
/** A request this long already says what to do, so a hold on it is a misread and never waits on them. */
const WHOLE_REQUEST_WORDS = 8;

/** The chunks after which the Mac stops reading a turn and listens again. */
export const ENDS_TURN: ReadonlySet<string> = new Set([
  BRAIN_CHUNK.DONE,
  BRAIN_CHUNK.FAILED,
  BRAIN_CHUNK.CANCELLED,
  BRAIN_CHUNK.LIMITED,
]);

/** Said when the brain would only hold on words that were already all of it. */
const SAY_IT_AGAIN = "Sorry, I didn't quite catch that. Could you say it once more?";

interface AskDeps {
  home: string;
  now: () => string;
  turns: BrainTurns;
  views: Pick<SessionViews, 'list' | 'view'>;
  exchanges: RecentExchanges;
  address: AddressLimit;
  log?: (message: string) => void;
}

/** A turn the brain answered, for recall once the person has heard it. */
interface Answered {
  text: string;
  ended: boolean;
  held: boolean;
  moment: string;
  names: Awaited<ReturnType<AddressLimit['names']>>;
}

export class VoiceAsk {
  /** A guess at the answer started while they pause, adopted when the Mac sends the same words. */
  private readonly speculation: Speculation<Answered | undefined>;

  /** When the last answered turn held for the rest, so the next one may not hold again. */
  private heldAt: number | null = null;
  /** What the last reply did before it was cut off, kept until a reply that reached its end has been told. */
  private actedBeforeCut: string[] = [];
  /** Each change to where the guess stands, written one after another. */
  private guessWrites: Promise<void> = Promise.resolve();
  /** The context built last and when, shared by a guess and the question after it until a turn is kept. */
  private building: {
    at: number;
    built: Promise<{ context: string; sessions: number }>;
  } | null = null;

  /** The app the person was in at their last words, which the next turn's context names. */
  private lookingAt: string | undefined;
  /** The team's questions the asking device named, which the voice may answer like this machine's own. */
  private teamCalls: TeamCallBrief[] = [];
  private lookingAtWindow: string | undefined;
  /** The session the person has open on the phone, which the next turn is a follow up on. */
  private openSession: string | undefined;
  /** Whether they speak through a phone, which never starts a session. */
  private fromPhone = false;

  constructor(private readonly deps: AskDeps) {
    this.speculation = new Speculation(
      () => deps.turns.cancel(),
      (state) => this.noteGuess(state),
    );
  }

  /** `mirror` sees every chunk the asker does, so the Mac island can show a phone's turn. */
  async ask(
    socket: Peer,
    request: DaemonRequest,
    said: string,
    mirror?: (chunk: DaemonAskChunk) => void,
  ): Promise<void> {
    this.lookingAt = request.lookingAt;
    this.lookingAtWindow = request.lookingAtWindow;
    this.openSession = request.sessionId;
    this.fromPhone = request.origin !== undefined;
    // Before the brain runs a tool, since a start reads it to refuse a question from a phone.
    await noteAskedFrom(this.deps.home, request.origin?.deviceId, this.deps.now()).catch(
      () => undefined,
    );
    if (request.teamCalls !== undefined) {
      this.teamCalls = request.teamCalls;
      await keepTeamCalls(this.deps.home, request.teamCalls, this.deps.now()).catch(
        () => undefined,
      );
    }
    if (request.speculative === true) {
      // Answered at once: nothing of a guess is said on this request, only on the ask that adopts it.
      write(socket, { id: request.id, ok: true, outcome: 'guessing' });
      this.speculation.start(said, (seams) => this.turn(said, false, seams));
      return;
    }
    let ended = false;
    const forward = (chunk: DaemonAskChunk): void => {
      if (ENDS_TURN.has(chunk.kind)) ended = true;
      write(socket, { id: request.id, ok: true, chunk });
      mirror?.(chunk);
    };
    try {
      await this.answer(request, said, forward);
    } finally {
      // The Mac waits on an end before it listens again, so a turn that sent none would leave the orb silent for good.
      if (!ended) forward({ kind: BRAIN_CHUNK.DONE });
    }
  }

  private async answer(
    request: DaemonRequest,
    said: string,
    forward: (chunk: DaemonAskChunk) => void,
  ): Promise<void> {
    // Held keys say they are rules, and letting go says that is all of it, so no guess or hold applies.
    const rule = request.intent === ASK_INTENT.RULE;
    const resuming = request.intent === ASK_INTENT.RESUME;
    // Never hold twice running: words after a hold are the rest of it, so they are answered.
    const finished = rule || resuming || request.finished === true || this.justHeld();
    // Words sent after a hold carry a note a guess never had, so no guess is ever them.
    if (finished) this.speculation.drop();
    const guessed = finished ? null : await this.speculation.adopt(said, forward);
    if (guessed !== null) return this.keep(said, guessed.answer);
    // A question asked whole, so whatever it does is done, never held as a guess's.
    await this.noteGuess(GUESS_STATE.ASKED);
    const overtaken = this.speculation.takeOvertaken();
    const seams = { send: forward, wanted: () => true };
    const note = rule ? RULE_NOTE : resuming ? RESUME_NOTE : undefined;
    const greeted = request.greeted === true ? `${GREETED_NOTE}\n` : '';
    const words = `${greeted}${note === undefined ? '' : `${note}\n`}${said}`;
    await this.keep(said, await this.turn(words, finished, seams, overtaken));
  }

  private justHeld(): boolean {
    return (
      this.heldAt !== null && Date.parse(this.deps.now()) - this.heldAt < HELD_WITHIN_MS
    );
  }

  /** Where the guess stands, written in the order it changed, since a tool that acts reads it. */
  private noteGuess(state: GuessState): Promise<void> {
    this.guessWrites = this.guessWrites
      .then(() => noteGuess(this.deps.home, state))
      .catch(() => undefined);
    return this.guessWrites;
  }

  /** What was said and answered, kept for recall, once the person has heard it. */
  private async keep(said: string, answered: Answered | undefined): Promise<void> {
    if (answered === undefined) return;
    // What was just said is part of the next context, so it is built afresh.
    this.building = null;
    this.heldAt = answered.held ? Date.parse(answered.moment) : null;
    this.deps.address.noteSaid(answered.text, answered.names, this.deps.now());
    // Held or talked over, the words come again whole, so only the turn that ends is one.
    if (answered.ended)
      await this.deps.exchanges.add({
        at: answered.moment,
        said,
        answered: answered.text,
      });
  }

  /**
   * One question to the brain, with the sessions put in front of it. A guess runs the same way
   * and only differs in where its chunks go, so an adopted guess is the answer it would have been.
   */
  private async turn(
    said: string,
    finished: boolean,
    seams: GuessSeams,
    overtaken = false,
  ): Promise<Answered | undefined> {
    const { home, now, address } = this.deps;
    const trace = new VoiceTurnTrace(home, now, said.split(/\s+/).length);
    const moment = now();
    // Best effort: without it the brain looks the sessions up itself, only slower.
    const { context, sessions } = await this.contextFor(moment);
    trace.contextBuilt(moment, sessions);
    const acted = this.actedBeforeCut;
    const whole = [
      overtaken ? OVERTAKEN_NOTE : '',
      acted.length === 0 ? '' : actedNote(acted),
      said,
      finished ? FINISHED_NOTE : '',
    ]
      .filter((part) => part !== '')
      .join('\n');
    await trace.brainStarted();
    const names = await address.names();
    let heard = false;
    const mayHold = !finished && said.split(/\s+/).length < WHOLE_REQUEST_WORDS;
    const ask = (
      words: string,
      send: GuessSeams['send'],
    ): ReturnType<typeof streamTurn> =>
      streamTurn(
        this.deps.turns,
        context === '' ? words : `${context}\n${words}`,
        (chunk) => {
          trace.chunk(chunk);
          send(chunk);
        },
        address.unsaid(names, now()),
        () => (heard = seams.wanted()),
      );
    let turn = await ask(whole, mayHold ? seams.send : withoutHolds(seams.send));
    // A hold after it already said something is that reply, a question usually, so it ends there.
    const spoke = turn.answered.trim() !== '';
    // Asked again here, at once, rather than the Mac listening for more that is not coming.
    if (!mayHold && turn.held && !spoke)
      turn = await ask(`${whole}\n${FINISHED_NOTE}`, withoutHolds(seams.send));
    // Held again on words marked whole, which sent nothing at all: the person hears that it was missed.
    if (!mayHold && turn.held) {
      if (!spoke && turn.answered.trim() === '')
        seams.send({ kind: BRAIN_CHUNK.TEXT, text: SAY_IT_AGAIN });
      seams.send({ kind: BRAIN_CHUNK.DONE });
    }
    await trace.finish();
    // Told once a reply that heard it ran to its end; a reply cut off after acting is remembered for the next.
    if (heard && turn.ended) this.actedBeforeCut = [];
    if (!turn.ended && !turn.held && turn.acted.length > 0)
      this.actedBeforeCut = [...new Set([...acted, ...turn.acted])];
    return heard
      ? { text: turn.answered, ended: turn.ended, held: turn.held, moment, names }
      : undefined;
  }

  /** The context a guess a moment ago is already building, or a new one. */
  private contextFor(moment: string): Promise<{ context: string; sessions: number }> {
    const at = Date.parse(moment);
    if (this.building !== null && at - this.building.at < CONTEXT_REUSE_MS)
      return this.building.built;
    const built = this.buildContext(moment);
    this.building = { at, built };
    return built;
  }

  /** What is put ahead of their words: the recall, then the sessions right now. */
  private async buildContext(
    moment: string,
  ): Promise<{ context: string; sessions: number }> {
    const exchanges = await this.deps.exchanges.read(moment);
    const [cards, focus, waiting, asking, open, answered] = await Promise.all([
      this.deps.views.list().catch(() => []),
      new VoiceFocusStore(this.deps.home).read().catch(() => null),
      waitingOnYes(this.deps.home, moment, lastAnswered(exchanges)),
      new AgentQuestions(this.deps.home).open(moment).catch(() => []),
      this.openView(),
      answeredSince(this.deps.home, moment, lastAnswered(exchanges)),
    ]);
    const [heardWords, folders, held, profile] = await Promise.all([
      readHeardWords(this.deps.home).catch(() => []),
      folderUses(this.deps.home, Date.parse(moment)).catch(() => []),
      new WaitingFeed(this.deps.home)
        .current(moment)
        .then((events) => events.filter((each) => each.kind === DAEMON_EVENT.HELD))
        .catch(() => []),
      readProfile(this.deps.home).catch(() => ({ facts: [], offeredAt: moment })),
    ]);
    const offered = profile.offeredAt !== undefined;
    // The invitation goes out in one turn only, so it is marked the moment it is put in front of the brain.
    if (profile.facts.length === 0 && !offered)
      await noteOffered(this.deps.home, moment).catch(() => undefined);
    const spoke = exchanges.filter((each) => each.unasked !== true).at(-1)?.at;
    const context = [
      momentContext(new Date(moment), spoke),
      phoneContext(this.fromPhone),
      lookingAtContext(this.lookingAt),
      windowContext(this.lookingAtWindow),
      profileContext(profile.facts, offered),
      heardWordsContext(heardWords),
      foldersContext(folders),
      recallContext(exchanges, waiting),
      answeredContext(answered),
      questionsContext(asking),
      heldCallsContext(held),
      teamCallsContext(this.teamCalls),
      openSessionContext(open),
      // Last, since it ends in the heading their words follow.
      askContext(cards, new Date(moment), focus),
    ]
      .filter((part) => part !== '')
      .join('\n');
    return { context, sessions: cards.length };
  }

  /** A phone may only name a session, so one nothing is known about is left out rather than refused. */
  private async openView(): Promise<SessionView | null> {
    const sessionId = this.openSession;
    if (sessionId === undefined) return null;
    const view = await this.deps.views.view(sessionId).catch(() => null);
    if (view === null)
      this.deps.log?.(
        `ask named ${JSON.stringify(sessionId)}, which no session view knows`,
      );
    return view;
  }
}
