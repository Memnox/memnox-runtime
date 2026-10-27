import { DECISION_EFFECT } from '../constants/decision.constants';
import { TOOL_CLASS, type ToolClass } from '../discovery/classify';
import type { MemnoxEvent } from '../event/event';

/**
 * What could safely be handed over next, from what a person has already approved. Every
 * number is a count of something that happened, because a percentage cannot be checked.
 */

/** Interruptions as a share of all actions: above the first steered, below the second self-running. */
const ASSIST_ASK_RATE = 0.2;
const SUPERVISED_ASK_RATE = 0.02;

export const AUTONOMY = {
  /** Watched, nothing enforced. Where every install starts. */
  OBSERVE: 'observe',
  /** Asked about the things that change something. */
  ASSIST: 'assist',
  /** Routine work runs; anything outward or destructive is held. */
  SUPERVISED: 'supervised',
  /** Runs on its own, inside a boundary somebody wrote. */
  AUTONOMOUS: 'autonomous',
  /** Runs on its own, and the boundary has stopped catching anything. */
  TRUSTED: 'trusted',
} as const;

export type AutonomyLevel = (typeof AUTONOMY)[keyof typeof AUTONOMY];

export const AUTONOMY_ORDER: readonly AutonomyLevel[] = [
  AUTONOMY.OBSERVE,
  AUTONOMY.ASSIST,
  AUTONOMY.SUPERVISED,
  AUTONOMY.AUTONOMOUS,
  AUTONOMY.TRUSTED,
];

/** Identical yeses before the same question stops being worth asking. */
export const PROMOTION_THRESHOLD = 5;

/** Actions in the window before the top two rungs can be claimed, since quiet is not proof. */
export const MINIMUM_EVIDENCE = 50;

/** Targets one handed-over rule lists before the approvals read as a pattern nobody named. */
export const MOST_HANDED_TARGETS = 20;

/** Characters a rule's target reads as a pattern, so a target holding one cannot be named exactly. */
const PATTERN_MARKS: readonly string[] = ['*', '!', '{workspace}'];

export interface Delegation {
  action: string;
  /** Times a person said yes to this exact thing. */
  approvals: number;
  /** Times a person said no. One is enough to stop a recommendation. */
  denials: number;
  lastAt: string;
  /** The widest class it was ever recorded under, since a rule allows the action at its worst. */
  class: ToolClass;
  /**
   * What the yeses were about, distinct. A handed-over rule names these and no others, so
   * it allows what was approved rather than the action everywhere. Empty when none carried one.
   */
  targets: string[];
  /** What this could become, and never more than the class allows. */
  recommendation: AutonomyLevel;
  /** Why, in the words the screen prints. */
  because: string;
}

/** The highest rung each class can reach, because forty right deletions precede the wrong one. */
const CEILING: Readonly<Record<string, AutonomyLevel>> = {
  [TOOL_CLASS.READ]: AUTONOMY.TRUSTED,
  [TOOL_CLASS.WRITE]: AUTONOMY.AUTONOMOUS,
  [TOOL_CLASS.COMMUNICATION]: AUTONOMY.SUPERVISED,
  [TOOL_CLASS.DESTRUCTIVE]: AUTONOMY.SUPERVISED,
  [TOOL_CLASS.UNKNOWN]: AUTONOMY.SUPERVISED,
};

function ceilingFor(toolClass: ToolClass): AutonomyLevel {
  return CEILING[toolClass] ?? AUTONOMY.SUPERVISED;
}

interface Tally {
  approvals: number;
  denials: number;
  lastAt: string;
  class: ToolClass;
  targets: Set<string>;
}

/** How far each class reaches, so a tally keeps the worst one it saw. */
const CLASS_REACH: Readonly<Record<string, number>> = {
  [TOOL_CLASS.READ]: 0,
  [TOOL_CLASS.WRITE]: 1,
  [TOOL_CLASS.COMMUNICATION]: 2,
  [TOOL_CLASS.UNKNOWN]: 2,
  [TOOL_CLASS.DESTRUCTIVE]: 3,
};

function widerClass(held: ToolClass, seen: ToolClass): ToolClass {
  return (CLASS_REACH[seen] ?? 2) > (CLASS_REACH[held] ?? 2) ? seen : held;
}

/**
 * What a person has decided, per action: an authorized `ask` is a yes and a `deny` a no.
 * An `allow` is a rule deciding, so counting it would promote what was never asked.
 */
export function delegations(
  events: readonly MemnoxEvent[],
  threshold = PROMOTION_THRESHOLD,
): Delegation[] {
  const tallies = new Map<string, Tally>();
  for (const event of events) {
    const asked = event.effect === DECISION_EFFECT.ASK;
    const denied = event.effect === DECISION_EFFECT.DENY;
    if (!asked && !denied) continue;

    tallies.set(event.operation, counted(tallies.get(event.operation), event, asked));
  }

  const found: Delegation[] = [];
  for (const [action, tally] of tallies) {
    found.push({
      action,
      approvals: tally.approvals,
      denials: tally.denials,
      lastAt: tally.lastAt,
      class: tally.class,
      targets: [...tally.targets].sort(),
      ...recommend(tally, threshold),
    });
  }
  return found.sort(
    (a, b) => b.approvals - a.approvals || a.action.localeCompare(b.action),
  );
}

/** One held event added to what was already counted for its action. */
function counted(held: Tally | undefined, event: MemnoxEvent, asked: boolean): Tally {
  const tally = held ?? {
    approvals: 0,
    denials: 0,
    lastAt: event.at,
    class: event.class,
    targets: new Set<string>(),
  };
  if (asked && event.authorizedBy !== undefined) {
    tally.approvals += 1;
    if (event.target !== undefined && event.target !== '')
      tally.targets.add(event.target);
  }
  if (!asked) tally.denials += 1;
  if (event.at > tally.lastAt) tally.lastAt = event.at;
  tally.class = widerClass(tally.class, event.class);
  return tally;
}

function recommend(
  tally: Tally,
  threshold: number,
): { recommendation: AutonomyLevel; because: string } {
  if (tally.denials > 0) {
    // One no is enough: a thing somebody refused is a thing they want to be asked about.
    return {
      recommendation: AUTONOMY.ASSIST,
      because: `refused ${tally.denials} time(s); keep asking`,
    };
  }
  if (tally.approvals < threshold) {
    return {
      recommendation: AUTONOMY.ASSIST,
      because: `approved ${tally.approvals} time(s), fewer than the ${threshold} that would make this a habit`,
    };
  }

  const ceiling = ceilingFor(tally.class);
  const because =
    ceiling === AUTONOMY.SUPERVISED
      ? `approved ${tally.approvals} times, and stays supervised because it is ${tally.class}`
      : `approved ${tally.approvals} times with no refusal`;
  return { recommendation: ceiling, because };
}

/** The ones worth putting on a screen: a habit, and nothing arguing against it. */
export function promotable(
  found: readonly Delegation[],
  threshold = PROMOTION_THRESHOLD,
): Delegation[] {
  return found.filter((each) => {
    const held = holdBackOf(each, threshold);
    // Shown with its reason: a habit worth seeing even where no single rule can take it.
    return (
      held === null || held.kind === HOLD_BACK.CEILING || held.kind === HOLD_BACK.WIDER
    );
  });
}

/** How often somebody is interrupted, as a count: hours saved would be a number nobody can check. */
export function interruptions(
  events: readonly MemnoxEvent[],
  since: string,
): { total: number; byAction: { action: string; count: number }[] } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const event of events) {
    if (event.effect !== DECISION_EFFECT.ASK) continue;
    if (event.at < since) continue;
    total += 1;
    counts.set(event.operation, (counts.get(event.operation) ?? 0) + 1);
  }
  return {
    total,
    byAction: [...counts]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Where this machine sits on the ladder, read off what is configured and seen rather than declared. */
export function standingOf(input: {
  enforcing: boolean;
  rules: number;
  asksInWindow: number;
  actionsInWindow: number;
}): AutonomyLevel {
  if (!input.enforcing || input.rules === 0) return AUTONOMY.OBSERVE;
  if (input.actionsInWindow === 0) return AUTONOMY.ASSIST;
  const askRate = input.asksInWindow / input.actionsInWindow;
  if (askRate > ASSIST_ASK_RATE) return AUTONOMY.ASSIST;
  if (askRate > SUPERVISED_ASK_RATE) return AUTONOMY.SUPERVISED;

  // Quiet is not proved: the rungs above claim a boundary was tested, and three commands test none.
  if (input.actionsInWindow < MINIMUM_EVIDENCE) return AUTONOMY.SUPERVISED;

  if (input.asksInWindow > 0) return AUTONOMY.AUTONOMOUS;
  return AUTONOMY.TRUSTED;
}

export function describeLevel(level: AutonomyLevel): string {
  const words: Record<AutonomyLevel, string> = {
    [AUTONOMY.OBSERVE]: 'watching, enforcing nothing',
    [AUTONOMY.ASSIST]: 'asking about most things that change something',
    [AUTONOMY.SUPERVISED]: 'routine work runs, the rest is held',
    [AUTONOMY.AUTONOMOUS]: 'running inside a boundary you wrote',
    [AUTONOMY.TRUSTED]: 'running, and the boundary has caught nothing',
  };
  return words[level];
}

/**
 * Whether one action may stop being asked about, and the sentence for why not, so a
 * screen and the command under it cannot disagree.
 */
export type HandOverVerdict =
  | { action: string; ready: true; delegation: Delegation }
  | { action: string; ready: false; because: string };

export function handOverVerdict(
  action: string,
  found: readonly Delegation[],
  threshold = PROMOTION_THRESHOLD,
): HandOverVerdict {
  const seen = found.find((each) => each.action === action);
  if (seen === undefined) {
    return {
      action,
      ready: false,
      because: 'nothing has been held for it, so there is no yes to stop asking for',
    };
  }
  const held = holdBackOf(seen, threshold);
  if (held !== null) return { action, ready: false, because: held.because };
  return { action, ready: true, delegation: seen };
}

/** The rows on a screen that `--allow` would actually take, so neither names the other wrongly. */
export function handable(each: Delegation, threshold = PROMOTION_THRESHOLD): boolean {
  return holdBackOf(each, threshold) === null;
}

const HOLD_BACK = {
  REFUSED: 'refused',
  TOO_FEW: 'too-few',
  /** The class ceiling: a habit, and still a decision however routine it became. */
  CEILING: 'ceiling',
  /** No rule could allow what was approved without allowing more than that. */
  WIDER: 'wider',
} as const;

type HoldBackKind = (typeof HOLD_BACK)[keyof typeof HOLD_BACK];

/** What keeps one action a question, checked once for the screen, the list and the command. */
function holdBackOf(
  seen: Delegation,
  threshold: number,
): { kind: HoldBackKind; because: string } | null {
  // One no outranks any number of yeses, exactly as the recommendation does.
  if (seen.denials > 0) {
    return {
      kind: HOLD_BACK.REFUSED,
      because: `somebody refused it ${seen.denials} time(s), so it stays a question`,
    };
  }
  if (seen.approvals < threshold) {
    return {
      kind: HOLD_BACK.TOO_FEW,
      because: `approved ${seen.approvals} time(s), fewer than the ${threshold} that make it a habit`,
    };
  }
  // Recommended at a higher threshold than this one asks about.
  if (seen.recommendation === AUTONOMY.ASSIST) {
    return { kind: HOLD_BACK.TOO_FEW, because: seen.because };
  }
  if (seen.recommendation === AUTONOMY.SUPERVISED) {
    return {
      kind: HOLD_BACK.CEILING,
      because: `it is ${seen.class}, which stays supervised however routine it became`,
    };
  }
  return widerThanApproved(seen);
}

/**
 * Why a rule naming these targets would allow more than the yeses did, or null when it
 * would not. Promotion is earned on what was approved, so it must not reach past it.
 */
function widerThanApproved(
  seen: Delegation,
): { kind: HoldBackKind; because: string } | null {
  const patterned = seen.targets.find((target) =>
    PATTERN_MARKS.some((mark) => target.includes(mark)),
  );
  if (patterned !== undefined) {
    return {
      kind: HOLD_BACK.WIDER,
      because: `it was approved on ${patterned}, which a rule would read as a pattern and so allow more than that`,
    };
  }
  if (seen.targets.length > MOST_HANDED_TARGETS) {
    return {
      kind: HOLD_BACK.WIDER,
      because: `it was approved on ${seen.targets.length} different targets, more than one rule should list; hand over the ones you mean with memnox protect`,
    };
  }
  return null;
}

/** The rule's own words for how far a handed-over allow reaches, so the file says it too. */
export function describeHandedReach(each: Delegation): string {
  if (each.targets.length === 0) {
    return 'no approval named a target, so it allows the action wherever it runs';
  }
  return `only on the ${each.targets.length === 1 ? 'target' : `${each.targets.length} targets`} it was approved for`;
}
