/**
 * A line-delimited JSON protocol over a Unix socket, or a named pipe on Windows, kept small
 * because an interceptor asks on every command, so asking has to cost a connect and a line.
 */
import type { MachineStanding, PersonStanding } from './person-standing';
import type { DecisionEffect } from '../constants/decision.constants';
import type { CapabilityTally } from '../discovery/capabilities';
import type { RunTally } from '../session/notices';
import type { TurnTests } from '../session/turn-tests';
import type { DeliveryProof, Sight, Witness } from './delivery';
import type { DisplayKind, DisplayVia } from './display';
import type {
  ExtensionEventFields,
  ExtensionRequestFields,
  ExtensionResponseFields,
} from './extension-fields';
import { HOME_METHOD } from './home';
import { INTERCEPT_METHOD } from './intercept';
import { REMOTE_METHOD } from './remote';
import { SPEECH_METHOD } from './speech';
import { SPOKEN_RULE_METHOD } from './spoken-rule';
import type {
  CardExcerpt,
  CardFile,
  DisplayHost,
  SessionCard,
  SessionView,
} from './session-view';
import type { AskIntent, MailDraft, RuleDraft } from './voice-cards';

export const DAEMON_METHOD = {
  /** Rule on one action. The hot path, and the only one with a latency budget. */
  EVALUATE: 'evaluate',
  /** Ask a person, through whatever terminal the daemon owns. */
  HOLD: 'hold',
  /** Record how a command ended, so a session is one timeline and the breaker can count outcomes. */
  RECORD: 'record',
  /** Whether this session is held, asked before anything runs. */
  STATUS: 'status',
  /** Liveness, for `memnox doctor`. */
  PING: 'ping',
  /** Keeps the connection open and writes one line per thing that starts waiting on a person. */
  SUBSCRIBE: 'subscribe',
  /** What is waiting on a person right now: held calls and proposals. */
  WAITING: 'waiting',
  /** A person's answer to a held call or a proposal; a yes carries a signature unless the call stays within its session. */
  CONFIRM: 'confirm',
  /** The public half of the key a confirmation is signed with, trusted on first use. */
  REGISTER_KEY: 'register-key',
  /** What the person said, answered by their own agent CLI one chunk per line as it streams. */
  ASK: 'ask',
  /** Stops the answer in flight, usually because the person started talking over it. */
  CANCEL: 'cancel',
  /** Where a session's agent is on screen, so the Mac app can bring that window forward. */
  LOCATE: 'locate',
  /** Something happened rather than was asked: the brain says it, streamed like ASK. */
  BRIEF: 'brief',
  /** The person started talking: start the brain now so the answer skips the cold start. */
  WARM: 'warm',
  /** The names this machine uses, for the recognizer to listen for. */
  VOCABULARY: 'vocabulary',
  /** A session as it is right now, for the live window the Mac app opens on it. */
  SESSION_VIEW: 'session-view',
  /** The sessions lately, each as a card, for the switcher that turns through them. */
  SESSIONS_LIST: 'sessions-list',
  /** The Mac app saying whether an instruction it was asked to type landed, so nobody is told it did when it did not. */
  DELIVERED: 'delivered',
  /** The Mac app's own timings for the question just answered: hearing, waiting for the end, speaking. */
  TRACE: 'trace',
  /** Which of the person's agents can be the voice, and why the others cannot. */
  VOICE_AGENTS: 'voice-agents',
  /** The person picking which agent the voice thinks with, from the Mac app's settings. */
  CHOOSE_VOICE_AGENT: 'choose-voice-agent',
  /** Words the person fixed in what the Mac typed for them, kept so they are heard right next time. */
  LEARN_WORDS: 'learn-words',
  /** The Mac app answering a LOOK display with what was on screen: a capture and the window's outline. */
  SEEN: 'seen',
  /** One folder under the person's home, names and sizes only, so a phone browses the Mac without the brain or the screen. */
  FILES_LIST: 'files-list',
  /** Whether a person is signed in on this daemon, which is what the voice and the terminal act through. */
  PERSON: 'person',
  /** The Mac app starting the daemon's own sign in, which answers with the code and polls behind it. */
  PERSON_SIGN_IN: 'person-sign-in',
  /** The Mac app signing the daemon's person out, revoking this terminal on the control plane. */
  PERSON_SIGN_OUT: 'person-sign-out',
  /** The apps the person connected through the workspace, Gmail or Slack say, for the Mac's menu bar and notch. */
  CONNECTIONS_LIST: 'connections-list',
  /** Connecting one tool as the person, any toolkit and any role: answers its sign in page, opened on the Mac when asked there. */
  CONNECTIONS_SIGN_IN: 'connections-sign-in',
  /** Undoing every sign in the person made to one tool, answering the list as it now stands. */
  CONNECTIONS_SIGN_OUT: 'connections-sign-out',
  /** The tools anybody can connect, from the cloud's catalogue, so a screen offers more than the ones already known. */
  TOOLKITS_SEARCH: 'toolkits-search',
  /** Whether this machine is connected to a workspace, which is what carries rules, memory and phones to it. */
  MACHINE: 'machine',
  /** The Mac app connecting this machine to a workspace: the device flow `memnox login` runs, polled behind the answer. */
  MACHINE_SIGN_IN: 'machine-sign-in',
  /** The Mac app disconnecting this machine, which forgets its credential; rules already pulled stay in force. */
  MACHINE_SIGN_OUT: 'machine-sign-out',
  /** Dictation written the way the person would have typed it, by their own agent CLI kept warm for it. */
  POLISH: 'polish',
  /** Starts the process that polishes dictation, as the key goes down, so the answer skips its cold start. */
  POLISH_WARM: 'polish-warm',
  /** The person's own words typed into one session, verbatim and signed over `followUpMessage`, never read by the brain. */
  FOLLOW_UP: 'follow-up',
  ...REMOTE_METHOD,
  ...SPEECH_METHOD,
  ...HOME_METHOD,
  ...INTERCEPT_METHOD,
  ...SPOKEN_RULE_METHOD,
} as const;

export type DaemonMethod = (typeof DAEMON_METHOD)[keyof typeof DAEMON_METHOD];

export interface DaemonRequest extends ExtensionRequestFields {
  id: number;
  method: DaemonMethod;
  /**
   * The session the request is about. On ASK: the session the person has open on the phone,
   * which the brain treats as the one they follow up on; it names a session and grants nothing.
   * On FOLLOW_UP: the session the words are typed into.
   */
  sessionId?: string;
  agent?: string;
  action?: string;
  target?: string;
  /** On EVALUATE: what the payload carries that is sensitive, as `classificationLabel` names it, for a rule's `dataClassifications`. */
  dataClassification?: string;
  /** A digest. Arguments travel only on INTERCEPT, ruled on in memory and never kept. */
  argsDigest?: string;
  reason?: string;
  /** On RECORD: how the command ended. The breaker's error and progress signals. */
  exitCode?: number;
  /** On RECORD: whether it fell outside the declared task. */
  outOfScope?: boolean;
  /** On RECORD: only the drift is being reported, so nothing is charged or counted as done. */
  driftOnly?: boolean;
  /** On RECORD: what it cost, when a surface can report one. Never estimated. */
  costUsd?: number;
  /** On CONFIRM: the held call or proposal being answered. */
  subject?: string;
  /** On CONFIRM: a hold answer for a held call, or confirmed / declined for a proposal. */
  answer?: string;
  /** On CONFIRM: base64 DER ECDSA over the confirmation message. Absent on a refusal. On FOLLOW_UP: over `followUpMessage`. */
  signature?: string;
  /** On REGISTER_KEY: the base64 X9.63 P-256 point. */
  point?: string;
  /** On ASK: what the person said, whole, in their own words. On FOLLOW_UP: what they typed, sent as it is. */
  said?: string;
  /** On ASK: they were waited on for the rest and said nothing more, so `said` is the whole of it. */
  finished?: boolean;
  /** On ASK: how the person asked, chosen by the keys they held rather than by any word they said. */
  intent?: AskIntent;
  /** On ASK: the Mac already greeted them out loud this sitting, so the answer does not open with another hello. */
  greeted?: boolean;
  /** On POLISH: where it lands (email, work_chat, prompt...), the person's spellings, and text they selected. */
  family?: string;
  vocabulary?: string[];
  selection?: string;
  /**
   * On ASK: what they have said so far, sent at a pause before the Mac is sure they finished,
   * so the answer can start early. Nothing of it is said until an ask with the same words.
   */
  speculative?: boolean;
  /** On LEARN_WORDS: each word as it was typed and as the person corrected it. */
  learned?: { heard: string; meant: string }[];
  /** On ASK: the app in front of the person as they spoke, by name, so a misheard word is read against it. */
  lookingAt?: string;
  /** On ASK: the title of that app's window in front, which names the project an editor has open. */
  lookingAtWindow?: string;
  /** On any voice request: the name the person asked to be called. */
  owner?: string;
  /** On BRIEF: held, paused or back. */
  briefing?: string;
  /** On BRIEF back: when the person went away. */
  since?: string;
  /** On TRACE: the Mac's own steps for the question just answered. */
  spans?: MacSpan[];
  /** On VOICE_AGENTS: ask every installed agent again rather than answer from the last check. */
  recheck?: boolean;
  /** On CHOOSE_VOICE_AGENT: the agent's kind, such as cursor. */
  voiceAgent?: string;
  /** On DELIVERED: what the Mac read back after acting, which a verified outcome must carry. */
  proof?: DeliveryProof;
  /** On DELIVERED: the Mac already said out loud what the person has to do, so the brain adds nothing. */
  told?: boolean;
  /** On SEEN: what was on screen when the brain asked to look. */
  sight?: Sight;
  /** On delivered: the target's window just before and just after acting, with the words read off it. */
  evidence?: Witness;
}

/** One agent as the voice's settings show it: there or not, whether it answered, and whether it is the one. */
export interface VoiceAgentStatus {
  kind: string;
  label: string;
  installed: boolean;
  /** Kept to reading; one that is not is used only when nothing else answered. */
  sealed: boolean;
  /** Absent until it has been asked, true once it called a Memnox tool and said what it was asked to. */
  works?: boolean;
  /** Why it did not, in words a person can act on. */
  because?: string;
  /** Its own account's words when it answered something else, such as a spent plan or a missing model. */
  reply?: string;
  checkedAt?: string;
  chosen: boolean;
  /** What to install, or set up, when it is missing or cannot answer. */
  install: string;
}

/** One app the person connected through the workspace, by the cloud's lowercase toolkit slug. */
export interface ToolConnection {
  toolkit: string;
  /** Whether any of their sign ins to it is active and enabled, rather than pending, expired, failed or turned off. */
  connected: boolean;
  /** Reached on this machine itself, an MCP server or a signed in command line tool, so nothing is connected or disconnected here. */
  local?: true;
}

/** A step the Mac timed, hung on the trace of the question it belongs to. */
export interface MacSpan {
  name: string;
  startAt: string;
  endAt: string;
  attributes?: Record<string, string | number | boolean>;
}

export const BRIEFING = {
  /** A held call, told with what its session has been doing. */
  HELD: 'held',
  /** A session the breaker stopped. */
  PAUSED: 'paused',
  /** The person came back to their Mac. */
  BACK: 'back',
  /** Something worth telling without being asked: a session finished, committed or pushed. */
  NOTICE: 'notice',
} as const;

/** Where a session runs, as LOCATE answers it. */
export interface DaemonLocation {
  sessionId: string;
  agent: string;
  /** False once the agent's process has ended, so nothing is shown that is gone. */
  alive: boolean;
  app?: string;
  appPath?: string;
  tty?: string;
  cwd?: string;
}

/** Kinds an ASK chunk ends a turn with; anything else is more of the same turn. */
export const ASK_ENDS: readonly string[] = ['done', 'limited', 'failed', 'cancelled'];

/** One piece of an answer: words to speak, a tool being read, or how the turn ended. */
export interface DaemonAskChunk {
  kind: string;
  text?: string;
  tool?: string;
}

export { DISPLAY, DISPLAY_VIA, type DisplayKind, type DisplayVia } from './display';
export * from './session-view';

export const DAEMON_EVENT = {
  /** A call is held until a person answers it. */
  HELD: 'held',
  /** Something suggested a change a person has to confirm. */
  PROPOSAL: 'proposal',
  /** The breaker stopped a session. */
  PAUSED: 'paused',
  /** Something told before is no longer waiting: answered elsewhere, or expired. */
  SETTLED: 'settled',
  /** The person asked to see a session: its window brought forward, or its summary on a card. */
  SHOW: 'show',
  /** Something worth saying unasked: a session finished, committed or pushed. */
  NOTICE: 'notice',
} as const;

export type DaemonEventKind = (typeof DAEMON_EVENT)[keyof typeof DAEMON_EVENT];

/** One thing a person may want to hear about, in words that can be spoken as they are. */
export interface DaemonEvent extends ExtensionEventFields {
  kind: DaemonEventKind;
  /** The id a CONFIRM names: a pending id, a proposal id, or the session that paused. */
  subject: string;
  agent: string;
  summary: string;
  at: string;
  expiresAt?: string;
  /** On HELD, the facts a person hears, so the voice words them rather than reading a line. */
  agentName?: string;
  /** What it wants to do, as a phrase: "push to main". */
  what?: string;
  /** Why it was held rather than run. */
  why?: string;
  /** The task the session was given, in the person's words. */
  task?: string;
  /** On HELD and NOTICE, the person's latest follow up in that session when it is not the task itself. */
  lastAsk?: string;
  /** The folder the session works in, by name. */
  place?: string;
  /** On HELD and NOTICE, the session it is about, so the voice reads that one and never guesses. */
  sessionId?: string;
  /** On SHOW, whether to bring the session's window forward or put a card on screen. */
  display?: DisplayKind;
  /** On SHOW, the card's heading. */
  title?: string;
  /** On SHOW, where the session runs, so its own window can be found. */
  host?: DisplayHost;
  /** On a SHOW card, the files the session changed and a few of the changed lines. */
  files?: CardFile[];
  excerpt?: CardExcerpt;
  /** On NOTICE, what happened: finished, committed or pushed. */
  notice?: string;
  /** On a finished NOTICE, how its tests stood when it handed back, so only checked work is celebrated. */
  tests?: TurnTests;
  /** On a finished NOTICE, what the turn came to: actions, questions put to the person, refusals. */
  run?: RunTally;
  /** On a WALK card, one page per file, in the order the voice says them. */
  pages?: WalkPage[];
  /** On AGENTS, every agent the scan found. */
  agents?: AgentNode[];
  /** On AGENTS, what the machine can change outside itself; `total` is absent while still counting. */
  capabilities?: CapabilityTally;
  /** On TRACE, the waterfall to draw. */
  trace?: TraceCard;
  /** On DRAFT, the message to put in front of the person before it is sent. */
  draft?: MailDraft;
  /** On APP, the app's links opened in order after `host.appPath`, and what it reads as it opens; on LINK, the one page to open. */
  app?: { links: string[]; env?: Record<string, string> };
  /** On LAUNCH, a terminal app or an editor's agent panel rather than a terminal tab; on APP, a new chat first or the prefilled words sent. */
  via?: DisplayVia;
  /** On a PROPOSAL of a rule, the rule and where it could go, so the person picks a place before Touch ID. */
  rule?: RuleDraft;
  /**
   * On HELD, and on a PROPOSAL that answers one, the call stays inside its session's repository,
   * so a yes goes without Touch ID. Absent asks for it, which is every call that reaches further.
   */
  withinSession?: true;
}

/** A trace drawn as a waterfall: each step's place on the clock, how deep it sits, how it ended. */
export interface TraceCard {
  totalMs: number;
  rows: {
    name: string;
    depth: number;
    offsetMs: number;
    durationMs: number;
    status: string;
  }[];
}

/** One agent on the scan screen: who it is, and counted facts about what it reaches. */
export interface AgentNode {
  id: string;
  /** The product, which picks its logo: claude-code, cursor, codex-cli, hermes. */
  kind: string;
  name: string;
  /** MCP servers its configs launch. */
  servers: number;
  /** What else it can touch: shell, filesystem, git, network, browser, cloud, docker. */
  reaches: string[];
  /** Its sessions working right now, and open waiting on the person. */
  working: number;
  open: number;
  /** Each MCP server its configs launch, by name, with what the last scan heard it hold. */
  mcp?: AgentServer[];
  /** Command line tools signed in on this Mac that its shell can run, by name. */
  clis?: string[];
  /**
   * Each capability on the machine credited to the first agent that reaches it, so adding the
   * agents up gives the machine's real count. No `total` means still counting, never zero.
   */
  capabilities?: CapabilityTally;
}

/** One MCP server as the scan screen names it; counts are absent where no scan has asked it. */
export interface AgentServer {
  name: string;
  tools?: number;
  /** Of those, the ones that change something outside it. */
  changing?: number;
}

/** One file of a walk through: what the voice says about it and the lines it is about. */
export interface WalkPage {
  path: string;
  note: string;
  added?: number;
  removed?: number;
  lines: string[];
}

export interface DaemonResponse extends ExtensionResponseFields {
  id: number;
  ok: boolean;
  effect?: DecisionEffect;
  reason?: string;
  alternative?: { action: string; resource?: string; note: string };
  /** Set when a limit stopped this rather than a rule. */
  limit?: string;
  /** Set when the breaker held the session. Different from a denial, and said so. */
  paused?: { signal: string; reason: string };
  /** On SUBSCRIBE, one per line after the first acknowledgement. */
  event?: DaemonEvent;
  /** On WAITING. */
  waiting?: readonly DaemonEvent[];
  /** On LOCATE. */
  location?: DaemonLocation;
  /** On VOCABULARY. */
  words?: readonly string[];
  /** On SESSION_VIEW. */
  session?: SessionView;
  /** On SESSION_VIEW with a path: that file's diff, its hunks with the lines around each change. */
  diff?: CardExcerpt;
  /** On SESSIONS_LIST, the most recently active first. */
  sessions?: SessionCard[];
  /** On ASK, one per line; the turn ends with a chunk whose kind is in ASK_ENDS. */
  chunk?: DaemonAskChunk;
  /** On VOICE_AGENTS and CHOOSE_VOICE_AGENT, every agent the voice knows, preferred first. */
  voiceAgents?: VoiceAgentStatus[];
  /** On PERSON, PERSON_SIGN_IN and PERSON_SIGN_OUT: where the daemon's own sign in stands. */
  person?: PersonStanding;
  /** On MACHINE, MACHINE_SIGN_IN and MACHINE_SIGN_OUT: whether this machine is connected to a workspace. */
  machine?: MachineStanding;
  /** On CONNECTIONS_LIST and CONNECTIONS_SIGN_OUT: one per app the person connected, by toolkit. */
  connections?: ToolConnection[];
  /** On POLISH: the dictation as it should be typed. */
  polished?: string;
  /** On CONFIRM and REGISTER_KEY, what happened in a word or two; on PING, which memnox answered. */
  outcome?: string;
  version?: string;
  error?: string;
}

export function encode(message: DaemonRequest | DaemonResponse): string {
  return `${JSON.stringify(message)}\n`;
}
