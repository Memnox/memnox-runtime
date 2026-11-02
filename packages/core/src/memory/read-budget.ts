/**
 * How a memory read stays cheap for the agent reading it: an answer is the best lines that fit a
 * token budget, one line a memory, with a cursor for the rest, and a document is read by a line or
 * heading range rather than whole. Pure, so the session tools, the start hook and a test share it.
 */

/**
 * Four characters a token, the rough ratio of English and code under the common tokenizers. It is
 * an estimate on purpose: no tokenizer runs on a read path, and a budget needs to be close, not exact.
 */
export const CHARS_PER_TOKEN = 4;

/** Small enough that a first read costs less than one screen of a file, big enough for a dozen lines. */
export const DEFAULT_READ_BUDGET_TOKENS = 800;

/** No answer is cut finer than this, since a budget under one line answers nothing. */
const LEAST_READ_BUDGET_TOKENS = 100;

/** No answer grows past this, whatever is asked, so one call can never pull a whole store. */
export const MOST_READ_BUDGET_TOKENS = 8_000;

/** One memory said on one line is cut here, since a statement longer than this is a document. */
const MOST_LINE_CHARS = 240;

/** What a cursor opens with, so a cursor from another tool is refused rather than misread. */
const CURSOR_PREFIX = 'm';

/** The tokens a text costs an agent to read, estimated as characters over four and rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The budget an agent asked for, held inside the bounds, or the default when it asked for none. */
export function budgetOf(asked: unknown): number {
  const value = typeof asked === 'string' ? Number(asked) : asked;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return DEFAULT_READ_BUDGET_TOKENS;
  return Math.min(
    MOST_READ_BUDGET_TOKENS,
    Math.max(LEAST_READ_BUDGET_TOKENS, Math.round(value)),
  );
}

/** A cursor for the line at this position of a ranked list, passed back unchanged. */
export function lineCursorAt(position: number): string {
  return `${CURSOR_PREFIX}${position}`;
}

/** Where a cursor points, or null where it is not one this module wrote. */
export function readLineCursor(text: string | undefined): number | null {
  if (text === undefined) return null;
  const match = new RegExp(`^${CURSOR_PREFIX}(\\d+)$`).exec(text.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** One memory on one line: the statement, then its id and where and when it came from. */
export function oneMemoryLine(statement: string, id: string, origin: string): string {
  const flat = statement.replace(/\s+/g, ' ').trim();
  const cut =
    flat.length > MOST_LINE_CHARS ? `${flat.slice(0, MOST_LINE_CHARS)}...` : flat;
  return `${cut} [${id}; ${origin}]`;
}

/** One entry a ranked read may say, under the id a session remembers having said it by. */
export interface RankedLine {
  id: string;
  line: string;
}

export interface BudgetedLines {
  lines: RankedLine[];
  /** Where the next page starts, absent when this page reached the end. */
  next?: string;
  /** Lines after this page that were not said. */
  more: number;
  /** Lines skipped because this session was already shown them. */
  alreadyShown: number;
  tokens: number;
}

/**
 * The lines from the cursor on that fit the budget, best first, skipping any the session was
 * already shown. One line is always said even past the budget, so a page is never empty forever.
 */
export function fitLines(
  ranked: readonly RankedLine[],
  budget: number,
  options: { from?: number; shown?: ReadonlySet<string> } = {},
): BudgetedLines {
  const shown = options.shown ?? new Set<string>();
  const lines: RankedLine[] = [];
  let tokens = 0;
  let alreadyShown = 0;
  let at = options.from ?? 0;
  for (; at < ranked.length; at += 1) {
    const entry = ranked[at];
    if (entry === undefined) break;
    if (shown.has(entry.id)) {
      alreadyShown += 1;
      continue;
    }
    const cost = estimateTokens(entry.line);
    if (lines.length > 0 && tokens + cost > budget) break;
    lines.push(entry);
    tokens += cost;
  }
  const rest = ranked.slice(at).filter((entry) => !shown.has(entry.id)).length;
  return {
    lines,
    ...(rest > 0 ? { next: lineCursorAt(at) } : {}),
    more: rest,
    alreadyShown,
    tokens,
  };
}

/** What part of a document is asked for: lines counted from 1, or the section under a heading. */
export interface ReadRange {
  /** `40-80`, `40-` to the end, or `40` alone. */
  lines?: string;
  /** Part of a heading's words; the section runs to the next heading as high or higher. */
  heading?: string;
}

export interface RangedText {
  text: string;
  /** The first and last line said, counted from 1. */
  from: number;
  to: number;
  /** Lines in the whole document. */
  total: number;
  /** The range to ask for next, absent when this reached the end of what was asked. */
  next?: string;
  tokens: number;
}

/**
 * The asked range of a document cut to the budget at a line boundary, or null where the range names
 * nothing in it. The whole document is the range when none is asked.
 */
export function readRange(
  content: string,
  range: ReadRange,
  budget: number,
): RangedText | null {
  const all = content.split('\n');
  const span = spanOf(all, range);
  if (span === null) return null;
  const lines: string[] = [];
  let tokens = 0;
  let at = span.from;
  for (; at <= span.to; at += 1) {
    const line = all[at - 1] ?? '';
    // A newline is a character too, so each line costs one more.
    const cost = estimateTokens(`${line}\n`);
    if (lines.length > 0 && tokens + cost > budget) break;
    lines.push(cutLine(line, budget, lines.length === 0));
    tokens += Math.min(cost, budget);
  }
  const to = span.from + lines.length - 1;
  return {
    text: lines.join('\n'),
    from: span.from,
    to,
    total: all.length,
    ...(to < span.to ? { next: `${to + 1}-${span.to}` } : {}),
    tokens,
  };
}

/** A first line longer than the whole budget is cut to it, so one huge line cannot blow the page. */
function cutLine(line: string, budget: number, first: boolean): string {
  const most = budget * CHARS_PER_TOKEN;
  return first && line.length > most ? `${line.slice(0, most)}...` : line;
}

function spanOf(
  all: readonly string[],
  range: ReadRange,
): { from: number; to: number } | null {
  if (range.heading !== undefined) return headingSpan(all, range.heading);
  if (range.lines === undefined) return { from: 1, to: all.length };
  const match = /^\s*(\d+)\s*(?:(-)\s*(\d+)?)?\s*$/.exec(range.lines);
  if (match === null) return null;
  const from = Math.max(1, Number(match[1]));
  const to =
    match[3] !== undefined
      ? Number(match[3])
      : match[2] !== undefined
        ? all.length
        : from;
  if (from > all.length || to < from) return null;
  return { from, to: Math.min(to, all.length) };
}

/** A Markdown heading's level, or zero for a line that is not one. */
function levelOf(line: string): number {
  return /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0;
}

function headingSpan(
  all: readonly string[],
  heading: string,
): { from: number; to: number } | null {
  const asked = heading
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
  if (asked === '') return null;
  const start = all.findIndex(
    (line) => levelOf(line) > 0 && line.toLowerCase().includes(asked),
  );
  if (start < 0) return null;
  const level = levelOf(all[start] ?? '');
  const after = all.findIndex(
    (line, at) => at > start && levelOf(line) > 0 && levelOf(line) <= level,
  );
  return { from: start + 1, to: after < 0 ? all.length : after };
}

/**
 * A JSON answer kept under the budget by cutting its longest lists from the end, saying how many
 * each lost, so a brief of unknown shape still fits rather than arriving whole.
 */
export function fitObject(
  value: Record<string, unknown>,
  budget: number,
): { value: Record<string, unknown>; cut: Record<string, number> } {
  const kept: Record<string, unknown> = { ...value };
  const cut: Record<string, number> = {};
  while (estimateTokens(JSON.stringify(kept)) > budget) {
    const longest = Object.entries(kept)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .sort(([, a], [, b]) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (longest === undefined || longest[1].length === 0) break;
    const [key, list] = longest;
    kept[key] = list.slice(0, -1);
    cut[key] = (cut[key] ?? 0) + 1;
  }
  return { value: kept, cut };
}
