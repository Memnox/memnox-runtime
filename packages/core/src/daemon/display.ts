/** How a show event wants to be shown, as the Mac app's Display mirrors it. */
export const DISPLAY = {
  /** Bring the session's own window forward. */
  OPEN: 'open',
  /** Put a summary card on screen while the voice reads it. */
  CARD: 'card',
  /** Type the person's confirmed instruction into the terminal tab the agent waits in. */
  TYPE: 'type',
  /** Open the session in its editor with the instruction in its input, for the person to send. */
  PREFILL: 'prefill',
  /** Turn through the sessions to this one and bring its own terminal tab or editor forward. */
  FOCUS: 'focus',
  /** Open a new terminal tab in a repository and type the line that starts an agent there. */
  LAUNCH: 'launch',
  /** Open an agent's own desktop app on a repository, with the task handed to it through its links. */
  APP: 'app',
  /** A card that pages through a session's changed files while the voice walks through them. */
  WALK: 'walk',
  /** The whole screen: every agent on this Mac, found by a live scan, with what each reaches. */
  AGENTS: 'agents',
  /** A trace as a waterfall card: what ran, inside what, for how long, and what failed. */
  TRACE: 'trace',
  /** Every session lately as one card each, together, so they can be read at a glance. */
  SESSIONS: 'sessions',
  /** Close the live window on a session and its own terminal tab, which ends the agent there. */
  CLOSE: 'close',
  /** Press Escape in the terminal a session runs in, which stops its turn where it is and keeps the tab. */
  INTERRUPT: 'interrupt',
  /** Take every Memnox card and window off the screen, leaving every agent and its tab alone. */
  DISMISS: 'dismiss',
  /** A message from the person's connected mail, drafted for them to read; Send is a signed CONFIRM of `subject`. */
  DRAFT: 'draft',
  /** Open a folder the person named; its title says where: finder, editor or terminal. */
  FOLDER: 'folder',
  /** Look at the screen: the Mac captures the window in front, or the app named in the title, and answers with SEEN. */
  LOOK: 'look',
  /** Press keys in the terminal a session runs in, the text naming them, to answer what its agent asks there. */
  PRESS: 'press',
  /** The icons of tools the person asked for and has not signed in to; each opens that tool's own sign in. */
  SIGN_IN: 'signin',
  /** A web page the person asked to open, its one http or https address in `links`, opened in their browser. */
  LINK: 'link',
} as const;

export type DisplayKind = (typeof DISPLAY)[keyof typeof DISPLAY];

/** How a LAUNCH reaches where it runs, when that is not a terminal tab or an editor's own terminal. */
export const DISPLAY_VIA = {
  /** Another terminal app, such as Ghostty, opened on the folder with the line typed into its new window. */
  TERMINAL_APP: 'terminal-app',
  /** An editor's agent panel, opened on the folder with the task sent as a new conversation. */
  PANEL: 'panel',
  /** On APP, a new chat started in the app before the words are typed, rather than the one open. */
  NEW_CHAT: 'new-chat',
  /**
   * On APP, the words the app's own prompt link left in its chat sent with Return, only once the Mac
   * reads them in the focused chat input; the Mac answers verified when it sent them.
   */
  SEND_PREFILLED: 'send-prefilled',
} as const;

export type DisplayVia = (typeof DISPLAY_VIA)[keyof typeof DISPLAY_VIA];

/** The named keys a PRESS may carry, as the Mac maps each to the key itself. */
export const TERMINAL_KEY = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  ENTER: 'enter',
  ESCAPE: 'escape',
  TAB: 'tab',
  SPACE: 'space',
} as const;

export type TerminalKey = (typeof TERMINAL_KEY)[keyof typeof TERMINAL_KEY];

/** Enough to move down a list of choices and pick one, never a sentence typed a key at a time. */
export const MOST_PRESSED_KEYS = 8;

/** One letter or digit, which is how a numbered or lettered choice is picked. */
const ONE_CHARACTER = /^[a-z0-9]$/;

const NAMED_KEYS: readonly string[] = Object.values(TERMINAL_KEY);

/** The keys named, in order, or null when any word is not a key, so only keys are ever pressed. */
export function terminalKeys(said: string): string[] | null {
  const keys = said
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word !== '');
  if (keys.length === 0 || keys.length > MOST_PRESSED_KEYS) return null;
  return keys.every((key) => NAMED_KEYS.includes(key) || ONE_CHARACTER.test(key))
    ? keys
    : null;
}
