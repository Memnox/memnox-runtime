import { setTimeout as sleep } from 'node:timers/promises';
import {
  DELIVERY,
  DISPLAY,
  DisplayRequests,
  HOUR_MS,
  SessionHosts,
  SessionTurns,
  SpokenInstructions,
  UNNAMED_SESSION,
  type DisplayDelivery,
  type DisplayRequest,
  type SessionHost,
  type SpokenInstruction,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { changesTool } from './changes-tool';
import { liveHost } from './live-host';
import { sessionMarks } from './session-marks';
import { paneOn, typeIntoPane, type Pane } from './multiplexer';
import { unlessMacTold } from './mac-told';
import { witnessed } from './witnessed';
import type { RewindSeams } from './rewind-tool';
import { scopeOf } from './session-scope';
import { turnOverByTranscript } from './sessions-tool';
import { withBrief } from './work-tools';
import { isHermesSession } from '../daemon/hermes-view';
import { typedInItsApp } from './app-follow-up';
import { HERMES_SAID, resumeHermes, type ResumeHermes } from './hermes-instruct';
import { FINDS_ITS_TAB } from './session-tools.constants';
import { agentInForeground } from './agent-foreground';

/**
 * Telling an agent what the person said out loud, read back first since a recognizer hears
 * "guitar push" for "git push", and handed over as the person's own request.
 */

const ROUTE = {
  /** Working: picked up after its next tool call, or as the next thing to do when its turn ends. */
  QUEUED: 'queued',
  /** Waiting in a terminal, an editor's integrated one included: typed into its prompt and sent. */
  TYPED: 'typed',
  /** Waiting in an editor: typed into its message box and sent. */
  PREFILLED: 'prefilled',
  /** Waiting where Memnox cannot reach: kept until the next time it is asked anything. */
  LATER: 'later',
} as const;

type Route = (typeof ROUTE)[keyof typeof ROUTE];

/** A turn asked longer ago than this and never handed back is an agent that went away, not one working. */
const WORKING_WITHIN_MS = 2 * HOUR_MS;

const OPENCLAW = 'openclaw';

/** Said plainly, since its actions are seen and recorded but nothing on this machine can hand it work yet. */
const OPENCLAW_SAID =
  'OpenClaw cannot be handed work from here yet. Say that you can see what it does and what it asked, but not type to it, and offer to tell it in its own chat instead.';

const EDITORS = /code|cursor|windsurf/i;

const SAID: Record<Route, string> = {
  queued:
    'It is working, so Memnox hands this over at its next step, beside its work: it never appears in the message box, and nothing needs typing. Say that in one sentence, like "Claude Code is busy, so I have handed it over, and it will pick it up at its next step."',
  typed:
    'The Mac typed it into its prompt, sent it and read the tab back to see it land, so it is starting on it now. Say so in a few words.',
  prefilled:
    'The Mac typed it into its message box in the editor, sent it and saw the box take it, so it is starting on it now. Say so in a few words.',
  later:
    'It is idle where Memnox cannot type, so it has not got this yet: it only reads it when the person next prompts that session. Never say it will pick it up at its next step or on its own. Say in one sentence that it has not reached it yet, and offer to type it in there for them now. On a yes, show it with display open and call send_instruction again. It runs in a terminal or an editor, never in a desktop app, since one there is typed into before this is said, so never call type_in_app for it: that types into a different chat. A session just started may not have come up yet, so if it is still not reached, say so and offer to try again in a moment. Never ask them to send it themselves.',
};

/** Sent, but the Mac could not read it back, so it is never called done. */
const SENT_UNCHECKED =
  'The Mac typed it in and sent it, but could not read it back to see it land. Say it went in and that you could not confirm it yet; never say it is done or that the agent started.';

/** The Mac kept the person's window, so the words wait for the session's next prompt. */
const WAITING =
  'It is idle in a chat panel the Mac could not reach, so it has not got this yet: it only reads it when the person next prompts that session. Never say it will pick it up at its next step or on its own. Say so in one sentence and offer to type it in there for them now; on a yes, do it. Never ask them to send it themselves.';

/** What the brain is told when the Mac said typing did not land, so it never says it did. */
const NOT_TYPED: Record<
  Exclude<
    DisplayDelivery['outcome'],
    typeof DELIVERY.TYPED | typeof DELIVERY.VERIFIED | typeof DELIVERY.WAITING
  >,
  string
> = {
  clipboard:
    'The Mac could not type it in safely, so the words are on their clipboard, and it has already said sorry and told them out loud how to paste it. Do not say sorry again, mention the clipboard or say it was sent: only ask, in one short question, whether to open the session, and keep listening for the answer.',
  failed:
    'The Mac could not type it in, and nothing was sent anywhere. Do not say it is on its way or started. Say sorry in a few words and give the reason in why in plain words, never another cause such as focus, a tab not responding or needing a click. Sending it to this session again fails the same way, so never offer to retry it. Offer, as one question, the one thing that works: to start a new session with these same words as its task, where they work, such as inside VS Code when they asked for it there, which propose_start does.',
  'not-allowed':
    'The Mac is not allowed to type yet, and it has already told them out loud how to allow it and that the words are on their clipboard. Write nothing at all this turn: every word you add repeats what they just heard. Only when they later say they switched it on, or ask you to try again, call propose_instruction with the same words and then send_instruction at once, with nothing said in between.',
};

/** The Mac never answered, so all that is known is that it was handed over. */
const UNCONFIRMED =
  'Handed to the Mac to type into its prompt, which has not confirmed it landed yet. Say it is going in now; never say it was typed, sent or started.';

const NEEDS_MESSAGE = "Pass message: the instruction in the person's words.";

export async function proposeInstructionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
  seams?: RewindSeams,
): Promise<unknown> {
  const message = textArg(args, 'message');
  if (message === undefined) return { proposed: false, said: NEEDS_MESSAGE };
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null || scope.sessionId === UNNAMED_SESSION) {
    return { ...scope, proposed: false, said: 'No agent session was found to tell.' };
  }
  const said = textArg(args, 'said');
  const about = textArg(args, 'about');
  const { text: told, found } = await withBrief(deps, args, message);
  const instruction = await new SpokenInstructions(deps.home).propose({
    sessionId: scope.sessionId,
    agent: scope.agent,
    message:
      about === undefined || seams === undefined
        ? told
        : await withWorkOf(deps, seams, about, told),
    ...(said === undefined ? {} : { said }),
    at: deps.now().toISOString(),
  });
  await noteFocus(deps, scope, 'told');
  return {
    ...scope,
    proposed: true,
    instruction: instruction.id,
    readBack: message,
    ...(found === undefined ? {} : { found }),
    said: 'Nothing is sent yet. If you already asked them anything in this reply, write nothing more and wait for their answer, since a second question is the same question twice. When they asked for this plainly, call send_instruction with this id now, in this same turn, with no read back and no words before it. Only when you had to guess at their words or at which session, read the gist back once as a short question, such as "Shall I ask Claude Code to push the voice branch?", and call send_instruction after they say yes.',
  };
}

/** Most files named in a hand off, so the line typed into the other agent stays one line. */
const MOST_HANDOFF_FILES = 8;

/**
 * A hand off from one agent to another: the person's words, then where the other session's work
 * is, so "have Codex review what Claude just changed" reaches Codex with the files to look at.
 */
async function withWorkOf(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
  message: string,
): Promise<string> {
  const changed = (await changesTool(deps, seams, { session: sessionId }).catch(
    () => ({}),
  )) as {
    repository?: string;
    files?: { shown: { path: string }[] };
  };
  const files = (changed.files?.shown ?? [])
    .slice(0, MOST_HANDOFF_FILES)
    .map((each) => each.path);
  if (files.length === 0) return message;
  const where = changed.repository === undefined ? '' : ` in ${changed.repository}`;
  return `${message} The files to look at${where} are: ${files.join(', ')}.`;
}

/** Said when the yes came for words already sent or proposed too long ago, which they still want sent. */
const INSTRUCTION_GONE =
  'That instruction was used already or is more than five minutes old. They said yes to these words, so call propose_instruction with the same words and then send_instruction straight away, in this turn, with nothing said in between. Never tell them it expired, was used or is being proposed again.';

export async function sendInstructionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
  inForeground: (tty: string) => boolean = agentInForeground,
  resume: ResumeHermes = resumeHermes,
  { typedWhileWorking = false }: SendOptions = {},
): Promise<unknown> {
  const id = textArg(args, 'instruction');
  const moment = deps.now().toISOString();
  const store = new SpokenInstructions(deps.home);
  const instruction = id === undefined ? null : await store.take(id, moment);
  if (instruction === null) return { sent: false, said: INSTRUCTION_GONE };
  const outsideHooks = deliveredOutsideHooks(instruction, resume);
  if (outsideHooks !== null) return outsideHooks;
  const recorded = await new SessionHosts(deps.home).read(instruction.sessionId);
  // Where it runs now, since a tab recorded when it began may since be closed or someone else's.
  const host = recorded === null ? null : liveHost(recorded);
  const route = await routeFor(
    deps,
    instruction.sessionId,
    host,
    inForeground,
    typedWhileWorking,
  );
  const inApp = await typedInItsApp(deps, instruction, host, route === ROUTE.LATER);
  if (inApp !== null) return inApp;
  // A tmux or WezTerm pane is typed into through its own command line, whatever app shows it.
  const pane =
    route !== ROUTE.QUEUED &&
    host?.tty !== undefined &&
    !FINDS_ITS_TAB.test(host.app ?? host.appPath ?? '') &&
    inForeground(host.tty)
      ? paneOn(host.tty, deps.panes)
      : null;
  if (pane !== null) return typedInPane(deps, instruction, pane);
  if (route === ROUTE.QUEUED || route === ROUTE.LATER) {
    await store.queue(instruction, moment);
    return { sent: true, session: instruction.sessionId, how: route, said: SAID[route] };
  }
  // Typing that failed a moment ago on this same terminal fails again, so it is said at once.
  const failedBefore = failedTyping(deps, instruction.sessionId, host);
  if (failedBefore !== null) return saidAgain(instruction.sessionId, failedBefore);
  return typedAs(deps, instruction, route, host);
}

/**
 * The agents no hook drains a queued note for: Hermes takes a turn from its own command line, so a
 * server with no Mac still reaches it, and OpenClaw is told plainly it cannot be handed work yet.
 */
function deliveredOutsideHooks(
  instruction: SpokenInstruction,
  resume: ResumeHermes,
): Record<string, unknown> | null {
  if (isHermesSession(instruction.sessionId)) {
    const started = resume(instruction.sessionId, instruction.message);
    return {
      sent: started,
      session: instruction.sessionId,
      how: started ? 'resumed' : DELIVERY.FAILED,
      said: started ? HERMES_SAID.started : HERMES_SAID.failed,
    };
  }
  if (instruction.agent !== OPENCLAW) return null;
  return {
    sent: false,
    session: instruction.sessionId,
    how: DELIVERY.FAILED,
    said: OPENCLAW_SAID,
  };
}

/** A send that failed the same way a moment ago, answered without the Mac trying it again. */
function saidAgain(sessionId: string, failed: FailedTyping): Record<string, unknown> {
  return {
    sent: false,
    session: sessionId,
    how: DELIVERY.FAILED,
    ...(failed.why === undefined ? {} : { why: failed.why }),
    said: `${NOT_TYPED.failed} It failed this way a moment ago, so it was not tried again.`,
  };
}

/** Typed into its pane and sent, and called landed only when the pane shows the words. */
async function typedInPane(
  deps: SessionToolDeps,
  instruction: SpokenInstruction,
  pane: Pane,
): Promise<Record<string, unknown>> {
  const typed = await typeIntoPane(pane, instruction.message, deps.panes);
  const sent = { session: instruction.sessionId, how: ROUTE.TYPED };
  if (!typed.sent) {
    return {
      ...sent,
      sent: false,
      how: DELIVERY.FAILED,
      why: `${pane.multiplexer} would not take the words for its pane`,
      said: NOT_TYPED.failed,
    };
  }
  return typed.proof === undefined
    ? { ...sent, sent: true, said: SENT_UNCHECKED }
    : { ...sent, sent: true, proof: typed.proof, said: SAID.typed };
}

/** Asks the Mac to type it, then says only what the Mac reported, so a failure is never called sent. */
async function typedAs(
  deps: SessionToolDeps,
  instruction: SpokenInstruction,
  route: Route,
  host: SessionHost | null,
): Promise<Record<string, unknown>> {
  const request = await showFor(deps, instruction, route, host);
  // Typing takes seconds and can fail, so nothing is said about it until the Mac has said how it went.
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  if (delivery === null) {
    return { sent: true, session: instruction.sessionId, how: route, said: UNCONFIRMED };
  }
  const said = await deliveredAs(deps, { instruction, route, host }, delivery);
  return { ...said, ...witnessed(delivery) };
}

/** The instruction the Mac was asked to type, by which route and into where. */
interface Typing {
  instruction: SpokenInstruction;
  route: Route;
  host: SessionHost | null;
}

/** What the brain may say once the Mac reported, so only what it saw land is ever called started. */
async function deliveredAs(
  deps: SessionToolDeps,
  { instruction, route, host }: Typing,
  delivery: DisplayDelivery,
): Promise<Record<string, unknown>> {
  const sent = { sent: true, session: instruction.sessionId };
  if (delivery.outcome === DELIVERY.VERIFIED || delivery.outcome === DELIVERY.TYPED) {
    FAILED_TYPING.delete(failureKey(deps, instruction.sessionId));
    return delivery.outcome === DELIVERY.TYPED
      ? { ...sent, how: route, said: SENT_UNCHECKED }
      : {
          ...sent,
          how: route,
          ...(delivery.proof === undefined ? {} : { proof: delivery.proof }),
          said: SAID[route],
        };
  }
  if (delivery.outcome === DELIVERY.WAITING) {
    await new SpokenInstructions(deps.home).queue(instruction, deps.now().toISOString());
    return { ...sent, how: ROUTE.LATER, said: WAITING };
  }
  return notTyped(deps, { sessionId: instruction.sessionId, host }, delivery);
}

/** A send the Mac could not type, remembered when trying again would fail the same way. */
function notTyped(
  deps: SessionToolDeps,
  { sessionId, host }: { sessionId: string; host: SessionHost | null },
  delivery: DisplayDelivery,
): Record<string, unknown> {
  const why = delivery.reason === undefined ? {} : { why: delivery.reason };
  if (
    delivery.outcome === DELIVERY.FAILED &&
    delivery.reason?.includes(FAILS_AGAIN) === true
  ) {
    FAILED_TYPING.set(failureKey(deps, sessionId), {
      ...(host?.tty === undefined ? {} : { tty: host.tty }),
      at: deps.now().getTime(),
      ...why,
    });
  }
  const said = isNotTyped(delivery.outcome)
    ? unlessMacTold(delivery, NOT_TYPED[delivery.outcome])
    : UNCONFIRMED;
  return { sent: false, session: sessionId, how: delivery.outcome, ...why, said };
}

function isNotTyped(outcome: string): outcome is keyof typeof NOT_TYPED {
  return Object.hasOwn(NOT_TYPED, outcome);
}

/** A send the Mac could not type, kept so asking again answers at once rather than failing the same way. */
interface FailedTyping {
  tty?: string;
  at: number;
  why?: string;
}

/** How the Mac ends a reason no retry can change, unlike an extension the person can still put in. */
const FAILS_AGAIN = 'would fail the same way';

/** Long enough to cover "try again" said straight after, short enough that a fixed terminal is tried afresh. */
const FAILED_TYPING_KEPT_MS = 5 * 60_000;

/** Kept for this process, which is the brain's conversation, keyed by home so tests never share it. */
const FAILED_TYPING = new Map<string, FailedTyping>();

function failureKey(deps: SessionToolDeps, sessionId: string): string {
  return `${deps.home}\0${sessionId}`;
}

/** The failure a moment ago on this same terminal, or null when there was none or it ran elsewhere since. */
function failedTyping(
  deps: SessionToolDeps,
  sessionId: string,
  host: SessionHost | null,
): FailedTyping | null {
  const failed = FAILED_TYPING.get(failureKey(deps, sessionId));
  if (failed === undefined) return null;
  const fresh = deps.now().getTime() - failed.at < FAILED_TYPING_KEPT_MS;
  return fresh && failed.tty === host?.tty ? failed : null;
}

/** How a send may reach a session beyond what the voice's own sends do. */
interface SendOptions {
  /**
   * The person's own typed words go into a working agent's prompt where it can be typed into, so they appear in
   * the session as their message, which the agent queues itself, rather than as a note nobody sees arrive.
   */
  typedWhileWorking?: boolean;
}

/** How it reaches the session: its next step when working, else whatever it waits in. */
async function routeFor(
  deps: SessionToolDeps,
  sessionId: string,
  host: SessionHost | null,
  inForeground: (tty: string) => boolean,
  typedWhileWorking = false,
): Promise<Route> {
  const turn = await new SessionTurns(deps.home).read(sessionId);
  const asked = turn?.promptAt;
  const working =
    asked !== undefined &&
    (turn?.endedAt === undefined || turn.endedAt < asked) &&
    deps.now().getTime() - Date.parse(asked) < WORKING_WITHIN_MS &&
    // Read the way the sessions tool reads it: Codex, and a turn the person stopped, end with no hook,
    // and a session told it is working when it waits on them is handed a note it never reads.
    !(await turnOverByTranscript(deps.home, sessionId, deps.now()));
  if (!working) return waitingRoute(host, inForeground);
  // Only a terminal prompt queues what is typed into it; an editor's panel would take it as a second chat.
  if (typedWhileWorking && waitingRoute(host, inForeground) === ROUTE.TYPED)
    return ROUTE.TYPED;
  return ROUTE.QUEUED;
}

/** A prompt in a terminal is typed into, an editor's own terminal too; an editor's chat panel is prefilled. */
export function waitingRoute(
  host: SessionHost | null,
  inForeground: (tty: string) => boolean,
): Route {
  if (host === null) return ROUTE.LATER;
  const app = host.app ?? host.appPath ?? '';
  if (host.panel === true) return EDITORS.test(app) ? ROUTE.PREFILLED : ROUTE.LATER;
  // Any other terminal app too: the Mac types there only when one tab is open, and otherwise says where to paste.
  if (host.tty !== undefined && app !== '' && inForeground(host.tty)) return ROUTE.TYPED;
  return EDITORS.test(app) && host.tty === undefined ? ROUTE.PREFILLED : ROUTE.LATER;
}

async function showFor(
  deps: SessionToolDeps,
  instruction: SpokenInstruction,
  route: Route,
  host: SessionHost | null,
): Promise<DisplayRequest> {
  const marks = await sessionMarks(deps, instruction.sessionId, host);
  return new DisplayRequests(deps.home).request({
    display: route === ROUTE.TYPED ? DISPLAY.TYPE : DISPLAY.PREFILL,
    sessionId: instruction.sessionId,
    agent: instruction.agent,
    title: 'Instruction',
    text: instruction.message,
    marks,
    ...(host?.cwd === undefined ? {} : { cwd: host.cwd }),
    // What an editor's extension checks its link against, so a link cannot aim the words at another terminal.
    ...(route === ROUTE.TYPED && host?.tty !== undefined ? { tty: host.tty } : {}),
    at: deps.now().toISOString(),
  });
}

/** Long enough for the comet, bringing the tab forward and typing a few sentences a key at a time. */
const DELIVERY_WAIT_MS = 25_000;
const DELIVERY_POLL_MS = 50;

/** What the Mac said became of a typed instruction, or null when it said nothing in time. */
export async function awaitDelivery(
  home: string,
  requestId: string,
  waitMs: number = DELIVERY_WAIT_MS,
): Promise<DisplayDelivery | null> {
  const requests = new DisplayRequests(home);
  const until = Date.now() + waitMs;
  let early: string | null = null;
  while (Date.now() < until) {
    const delivery = await requests.deliveryOf(requestId);
    if (
      delivery !== null &&
      delivery.reason === OLD_EXTENSION_NO_TERMINAL &&
      early === null
    ) {
      // An editor extension from before the hand over answers this itself, and the Mac then types it
      // into the agent panel, so only the Mac's own word after it says how it went.
      early = delivery.at;
    }
    if (delivery !== null && delivery.at !== early) return delivery;
    await sleep(DELIVERY_POLL_MS);
  }
  return null;
}

/** What an editor extension from before the hand over writes when no terminal holds the session. */
const OLD_EXTENSION_NO_TERMINAL = 'no integrated terminal holds its device';
