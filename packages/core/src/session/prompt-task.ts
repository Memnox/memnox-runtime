/**
 * What a person asked for, read from the prompt they typed, so a session has a task without
 * anybody running a command. Read by its words, never by a model: "investigate why the
 * payments failed" is an investigation, "investigate and fix it" is not.
 */
import { TASK_INTENT, taskFor, type SessionTask, type TaskIntent } from './session-task';

/** Long enough to recognise the ask in `why`, short enough never to be a document. */
const MOST_STATEMENT_CHARS = 200;

/** Words that say the person wants to understand something. */
const INVESTIGATING =
  /\b(investigate|diagnose|debug why|look into|find out|figure out|root cause|what happened|what caused|why (did|does|do|is|are|was|were)|audit|inspect|analy[sz]e)\b/;

/** Words that say the person wants something changed, which ends an investigation. */
const CHANGING =
  /\b(fix|implement|change|update|add|remove|delete|refactor|deploy|write|create|build|rename|migrate|patch|upgrade|install|commit|push|merge|release|revert|make|set up|configure|restart|rollback|roll back)\b/;

/** Words that hold the session to reading whatever else the prompt says. */
const HANDS_OFF =
  /\b(don'?t change|do not change|without changing|change nothing|read[- ]only|don'?t touch|do not touch|just look|only look)\b/;

/** An investigation when the prompt says so outright, or asks why and asks for no change. */
export function intentOfPrompt(prompt: string): TaskIntent | undefined {
  const text = prompt.toLowerCase();
  if (HANDS_OFF.test(text)) return TASK_INTENT.INVESTIGATE;
  if (INVESTIGATING.test(text) && !CHANGING.test(text)) return TASK_INTENT.INVESTIGATE;
  return undefined;
}

/** A pasted log line, a tag, an image marker or a fence: what somebody pasted, never what they asked. */
const NOT_THEIR_WORDS =
  /^(\d{4}-\d{2}-\d{2}[T ]\d|<\/?[a-z_-]+|\[(image|pasted)|```|\$ |>)/i;

/** Quotes and code marks somebody typed around a paste, which are not part of the ask. */
const WRAPPING = new Set(['`', "'", '"']);

/** A line without its wrapping and spaces at either end, by a loop rather than a pattern that could backtrack. */
function unwrapped(line: string): string {
  const wraps = (char: string | undefined): boolean =>
    char !== undefined && (WRAPPING.has(char) || char.trim() === '');
  let start = 0;
  let end = line.length;
  while (start < end && wraps(line[start])) start += 1;
  while (end > start && wraps(line[end - 1])) end -= 1;
  return line.slice(start, end);
}

/** Enough letters to be a sentence somebody typed rather than a stray mark. */
const MOST_WORDS_NEEDED = 3;

/**
 * The first line the person wrote themselves, clipped, which is the ask as they put it. A prompt
 * that opens with a pasted log or a stray backtick still has its question further down.
 */
export function statementOfPrompt(prompt: string): string {
  const lines = prompt
    .split('\n')
    .map((each) => unwrapped(each).trim())
    .filter((each) => each !== '' && !NOT_THEIR_WORDS.test(each));
  const line =
    lines.find((each) => (each.match(/[a-z]{2,}/gi) ?? []).length >= MOST_WORDS_NEEDED) ??
    lines.find((each) => /[a-z]/i.test(each)) ??
    '';
  return line.length <= MOST_STATEMENT_CHARS
    ? line
    : `${line.slice(0, MOST_STATEMENT_CHARS - 1)}…`;
}

/**
 * The task a prompt declares, or null for one that declares nothing. A hand declared task is never
 * replaced; the first prompt stays the mission and a follow up like "go ahead" is the latest ask.
 */
export function taskFromPrompt(
  prompt: string,
  existing: SessionTask | null,
  moment: { sessionId: string; now: string },
): SessionTask | null {
  if (existing !== null && existing.declaredBy !== DECLARED_BY_PROMPT) return null;
  const statement = statementOfPrompt(prompt);
  if (statement === '') return null;
  // The intent follows the latest prompt, so "now fix it" still lifts an investigation.
  const intent = intentOfPrompt(prompt);
  const task = taskFor(
    {
      sessionId: moment.sessionId,
      statement: existing?.statement ?? statement,
      scope: {},
      ...(intent === undefined ? {} : { intent }),
    },
    moment.now,
  );
  if (existing === null) return { ...task, declaredBy: DECLARED_BY_PROMPT };
  return {
    ...task,
    id: existing.id,
    declaredAt: existing.declaredAt,
    declaredBy: DECLARED_BY_PROMPT,
    latestAsk: statement,
  };
}

/** A task read from the session's prompt rather than declared by a person. */
export const DECLARED_BY_PROMPT = 'prompt';
