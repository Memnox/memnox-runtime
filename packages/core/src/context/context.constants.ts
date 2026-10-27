/**
 * The bounds on what Memnox says inside an agent's session. Named, because the context an
 * agent reads is paid for in its window on every turn, so every line has to earn its place.
 */

/** The whole boundary block, in characters, so a repository with many rules stays short. */
export const MOST_BOUNDARY_CHARS = 1200;

/** Rules named per group (never run, asked first); the rest are counted, not listed. */
export const MOST_RULES_PER_GROUP = 4;

/** One rule's line, in characters, so a long reason cannot take the block over. */
export const MOST_RULE_CHARS = 140;

/** Decisions handed over at one prompt or before one tool call. */
export const MOST_DECISIONS_PER_CALL = 2;

/** Decisions a session remembers having been shown, oldest let go past it. */
export const MOST_SHOWN_PER_SESSION = 64;

/** Questions a session keeps waiting on an answer for, oldest let go past it. */
export const MOST_PENDING_ASKS = 32;

/** How long a question put to a person stays answerable by the tool call running. */
export const ASK_ANSWER_MINUTES = 30;

/** Words of a prompt looked at for a path or an action, so a pasted file costs nothing. */
export const MOST_PROMPT_WORDS = 400;

/** A word shorter than this names nothing a decision could be about. */
export const SHORTEST_PROMPT_PATH = 3;

/** Session files untouched this long are let go: every window they serve is far shorter. */
export const SESSION_FILE_DAYS = 7;

/** How often the session files are swept, at most. */
export const PRUNE_EVERY_HOURS = 24;

/** Files let go in one sweep, so a hook never spends its budget deleting. */
export const MOST_PRUNED_PER_PASS = 200;

/** Under the Memnox home. */
export const CONTEXT_DIR = 'context';
export const CONTEXT_SESSIONS_DIR = 'sessions';
export const CONTEXT_PRUNED_FILE = 'pruned.json';

/** Under the Memnox home: the workspace memory as this machine last pulled it. */
export const WORKSPACE_MEMORY_FILE = 'memory.json';

/** Beside it: when the control plane last said it was unchanged, a few bytes rewritten a minute. */
export const WORKSPACE_MEMORY_SYNCED_FILE = 'memory-synced.json';

/** Settled facts handed over at one prompt or before one write. */
export const MOST_FACTS_PER_CALL = 3;

/** Settled decisions one write is recorded as bearing on, so a common word cannot list them all. */
export const MOST_DECISIONS_PER_WRITE = 8;

/** Settled facts a session tool answers with, so one lookup never fills a window. */
export const MOST_FACTS_ANSWERED = 12;

/** Unapproved candidates a session tool answers with: context, so fewer than the facts. */
export const MOST_CANDIDATES_ANSWERED = 5;

/** Unapproved candidates said at one prompt or before one write, kept to one since none of them decides anything. */
export const MOST_CANDIDATES_PER_CALL = 1;

/** Under the context directory: one brief per piece of work the voice handed an agent. */
export const WORK_BRIEFS_DIR = 'work';

/** Messages and tickets one brief carries, enough to work from and few enough to read whole. */
export const MOST_WORK_SOURCES = 16;

/** Set by `memnox run --brief`, so the agent's own hook hands it the brief before its first turn. */
export const WORK_BRIEF_VAR = 'MEMNOX_WORK_BRIEF';

/** Items one brief reads whole beside its ticket, so gathering stays inside a spoken read back. */
export const MOST_WORK_ITEMS_READ_WHOLE = 4;

/** What one item other than the ticket may carry, so a brief stays readable at a session's start. */
export const MOST_WORK_ITEM_CHARS = 6_000;
