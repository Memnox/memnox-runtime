/**
 * The home every surface opens on, the same five blocks on the Mac, the iPhone and the terminal:
 * what waits on the person, what is working, what happened today, the one thing that could be
 * handed over next, and what nothing covers. Counts, never scores.
 */

export const HOME_METHOD = {
  /** The five blocks, read once, so a screen draws them without asking five questions. */
  HOME: 'home',
  /** Turns the ready suggestion into a rule proposal the person confirms with Touch ID or Face ID. */
  HAND_OVER: 'hand-over',
} as const;

/** An agent at work right now, as one line on the home. */
export interface HomeWorking {
  sessionId: string;
  agent: string;
  agentName: string;
  task?: string;
  repository?: string;
}

/** What the ledger says since midnight, in counts a person can check. */
export interface HomeToday {
  actions: number;
  asked: number;
  allowed: number;
  refused: number;
}

/** The one action the record says could run without asking, and why. */
export interface HomeReady {
  action: string;
  approvals: number;
  /** Who was asked, where every yes came from one agent. */
  agentName?: string;
  /** What the yeses were about; the rule it becomes names these and no others. */
  targets: string[];
  because: string;
}

/** What no rule or seam covers here, said as counts. */
export interface HomeNotCovered {
  /** Agents found on this machine that run outside Memnox. */
  unprotected: number;
  /** Agents silent for a month that still hold reach. */
  dormant: number;
}

export interface HomeView {
  machine: string;
  mode: string;
  waiting: number;
  working: HomeWorking[];
  today: HomeToday;
  ready?: HomeReady;
  notCovered: HomeNotCovered;
  /**
   * What only the person can do for what is here to be in force, such as approving hooks in
   * Codex or restarting an agent that loads a plugin. Absent when nothing is owed.
   */
  needsYou?: string[];
}

export interface HomeResponseFields {
  /** On HOME. */
  home?: HomeView;
  /** On HAND_OVER: the proposal the person now confirms, by its id. */
  proposed?: string;
}
