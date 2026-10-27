/**
 * Sessions as the Mac's switcher and live window show them: the cards, the view of one, and the
 * lines of its conversation, carried by the daemon protocol's SESSIONS_LIST and SESSION_VIEW answers.
 */

/** Who said a line of a session's conversation. */
export const SPEAKER = {
  PERSON: 'person',
  AGENT: 'agent',
  /** A tool the agent ran, by its name and what it was for. */
  TOOL: 'tool',
} as const;

export type Speaker = (typeof SPEAKER)[keyof typeof SPEAKER];

/** A line of the conversation itself, as the live window shows it. */
export interface ConversationLine {
  at: string;
  who: Speaker;
  text: string;
}

/** A session as one card in the switcher: who, on what, in what state, and where it runs. */
export interface SessionCard {
  sessionId: string;
  /** Which agent it is, such as claude-code, so a screen can show its logo and keep its colour. */
  agent: string;
  agentName: string;
  task?: string;
  /**
   * What the session is about now, as its agent titles it, which a screen shows before the
   * task: the first thing asked is rarely what a long session turned into.
   */
  focus?: string;
  state: string;
  thinking: boolean;
  repository?: string;
  runningIn?: string;
  /** Where in that app, in words: a Terminal tab, an editor's terminal, or an agent's panel in it. */
  where?: string;
  lastActive?: string;
  /**
   * When the person last wrote to it themselves, so "the last session" is the one they last worked in
   * rather than whichever agent last ran a tool on its own.
   */
  spokenToAt?: string;
  /** When it began, so sessions can be told apart by the order they were started in. */
  startedAt?: string;
  /** What it has run, so a session that only said hello is never taken for the last one that worked. */
  actions?: number;
  host?: DisplayHost;
}

/** One thing a session did, as the live window lists it. */
export interface SessionViewStep {
  at: string;
  /** shell, file, network, mcp, git, or whatever surface the action was on. */
  surface: string;
  /** What it did, in a line: the operation and its target. */
  text: string;
  /** It failed, or was refused, which the window marks. */
  failed?: boolean;
  refused?: boolean;
}

/** A session as it is right now: what it is on, what it just did, and what it changed. */
export interface SessionView {
  sessionId: string;
  agent: string;
  agentName: string;
  /** What it was opened for: the task it was given, or the person's first request in it. */
  task?: string;
  /** The person's latest request in it, when it differs from the task, so a card says what it is on now. */
  lastAsk?: string;
  /** working, open, idle, quiet, ended or paused, as the sessions list says it. */
  state: string;
  /** Thinking through a turn even when nothing new is recorded. */
  thinking: boolean;
  repository?: string;
  /** The branch its repository has checked out. */
  branch?: string;
  runningIn?: string;
  /** Where in that app, in words: a Terminal tab, an editor's terminal, or an agent's panel in it. */
  where?: string;
  startedAt?: string;
  lastActive?: string;
  waitingOnYou: number;
  paused?: string;
  /** What its helpers are doing, one line each. */
  helpers: string[];
  /** Newest last, a dozen at most. */
  steps: SessionViewStep[];
  files: CardFile[];
  /** The changed lines of the file it changed most, so the code it is writing can be shown. */
  excerpt?: CardExcerpt;
  /** The conversation's latest lines, where the agent keeps a transcript Memnox can read. */
  conversation?: ConversationLine[];
  /** What the agent said to end its latest turn, cut short, which is where the work stands. */
  lastSaid?: string;
}

/** A file on a summary card, with its lines added and removed; a binary file has no counts. */
export interface CardFile {
  path: string;
  added?: number;
  removed?: number;
}

/** A few changed lines of one file, so the card shows the code itself and not only its name. */
export interface CardExcerpt {
  path: string;
  lines: string[];
}

/** Where a session runs, as far as its hook could see: the app, its terminal tab and its folder. */
export interface DisplayHost {
  app?: string;
  appPath?: string;
  tty?: string;
  cwd?: string;
  /**
   * The agent's own id for the conversation, which is what an editor's agent panel opens by,
   * where Memnox keyed the session by another.
   */
  conversation?: string;
  /** Lines only this session's tab shows, so the Mac can find it among a terminal app's tabs by what is in it. */
  marks?: string[];
}
