import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  isTestCommand,
  SessionHosts,
  SPEAKER,
  type ConversationLine,
  type TestRun,
} from '@memnox/core';

/**
 * The conversation itself, read from the file Claude Code keeps for each session, so the live
 * window shows what was asked and what the agent is saying and running. It is read for the
 * screen only: nothing of it is written to the ledger, and the agent's private thinking is left out.
 */

/** The end of a long session is all the window shows, so a day of conversation is never read whole. */
const TAIL_BYTES = 1_024 * 1_024;
/** Enough of the session for the window to read as its chat, scrolled back through a long afternoon. */
const MOST_LINES = 160;
/** A reply whole as the agent wrote it, which the window lays out, short of a pasted file. */
const MOST_SAID_CHARS = 2_400;
const MOST_TOOL_CHARS = 110;
/** A session id as Claude Code names its file, which is also what keeps a path out of it. */
const SAFE_ID = /^[A-Za-z0-9-]{8,80}$/;

/** The session's file under `~/.claude/projects`, or null when this is not a Claude Code session. */
function transcriptPath(home: string, sessionId: string): string | null {
  if (!SAFE_ID.test(sessionId)) return null;
  const projects = join(home, '.claude', 'projects');
  try {
    for (const project of readdirSync(projects)) {
      const file = join(projects, project, `${sessionId}.jsonl`);
      try {
        closeSync(openSync(file, 'r'));
        return file;
      } catch {
        // Not in this project, so the next one is tried.
      }
    }
  } catch {
    // No Claude Code here at all.
  }
  return null;
}

/**
 * The transcript of a session as the ledger names it. Under `memnox run` the ledger keys it by
 * its own id, so the agent's id noted beside where it runs is what the file is found by.
 */
export async function sessionTranscript(
  home: string,
  sessionId: string,
  transcripts: string = home,
): Promise<string | null> {
  const host = await new SessionHosts(home).read(sessionId).catch(() => null);
  return transcriptPath(transcripts, host?.agentSession ?? sessionId);
}

/**
 * What a session is about as its agent keeps it current, rather than the first thing it was
 * asked: Claude Code's own title for the session, rewritten as the work moves on, else the
 * name it was given. Null where the agent keeps neither, which leaves the opening ask.
 */
export async function sessionFocus(
  home: string,
  sessionId: string,
  transcripts: string = home,
): Promise<string | null> {
  const path = await sessionTranscript(home, sessionId, transcripts);
  if (path === null) return null;
  const changedAt = modifiedAt(path);
  const known = focusSeen.get(path);
  if (known !== undefined && known.changedAt === changedAt) return known.focus;
  const focus = focusIn(tailOf(path, FOCUS_TAIL_BYTES));
  focusSeen.set(path, { changedAt, focus });
  return focus;
}

/** The agent retitles every few turns, so the last stretch always holds the current title. */
const FOCUS_TAIL_BYTES = 256 * 1_024;

/** Each transcript's focus as of its last change, so the switcher refreshing reads nothing new. */
const focusSeen = new Map<string, { changedAt: number; focus: string | null }>();

function modifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** The newest title in a stretch of transcript, else the newest name, as plain words. */
export function focusIn(raw: string): string | null {
  let named: string | null = null;
  const lines = raw.split('\n');
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at] ?? '';
    // Only the two record kinds, so a reply quoting one is never taken for it.
    if (!line.startsWith(TITLE_RECORD) && !line.startsWith(NAME_RECORD)) continue;
    const record = recordOf(line);
    const title = record?.['aiTitle'];
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
    const name = record?.['agentName'];
    if (named === null && typeof name === 'string' && name.trim() !== '') {
      named = name.trim().replace(/[-_]+/g, ' ');
    }
  }
  return named;
}

const TITLE_RECORD = '{"type":"ai-title"';
const NAME_RECORD = '{"type":"agent-name"';

function recordOf(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The last stretch of the conversation, oldest first. */
export function readConversation(path: string): ConversationLine[] {
  return conversationIn(tailOf(path));
}

/** The lines of a transcript worth showing a person, from its raw JSON lines. */
export function conversationIn(raw: string): ConversationLine[] {
  return everyLineIn(raw).slice(-MOST_LINES);
}

/** Enough for a long day of one session, bounded so a runaway transcript is read from its end. */
const WHOLE_BYTES = 16 * 1024 * 1024;

/** Every line of the conversation, oldest first, for an account of the whole session. */
export function readWholeConversation(path: string): ConversationLine[] {
  return everyLineIn(tailOf(path, WHOLE_BYTES));
}

/** Every line in the last stretch of a transcript, for a reader that looks further back than the window does. */
export function readLinesFromEnd(path: string, bytes: number): ConversationLine[] {
  return everyLineIn(tailOf(path, bytes));
}

function everyLineIn(raw: string): ConversationLine[] {
  const lines: ConversationLine[] = [];
  for (const text of raw.split('\n')) {
    const entry = parsed(text);
    if (entry === null || entry.isSidechain === true || entry.isMeta === true) continue;
    if (typeof entry.parent_tool_use_id === 'string') continue;
    lines.push(...linesOf(entry));
  }
  return lines;
}

/** Enough of a session's start to hold its first request after whatever the agent loads first. */
const HEAD_BYTES = 256 * 1_024;

/** The person's first words in the session, which say what it was opened for, or null before they said any. */
export function readOpeningAsk(path: string): string | null {
  return openingAskIn(headOf(path));
}

function openingAskIn(raw: string): string | null {
  return everyLineIn(raw).find((line) => line.who === SPEAKER.PERSON)?.text ?? null;
}

/**
 * The person's latest words in the session, or null when the transcript's tail holds none. Read here rather than
 * from the prompt hook, which also fires for a helper's report or a harness notice the agent marks as not theirs.
 */
export function readLatestAsk(path: string): string | null {
  return latestAskIn(tailOf(path));
}

export function latestAskIn(raw: string): string | null {
  return latestPersonLine(everyLineIn(raw));
}

/** The newest line the person said, read from the end since that is where it most often is. */
export function latestPersonLine(lines: readonly ConversationLine[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line?.who === SPEAKER.PERSON) return line.text;
  }
  return null;
}

/** Long enough to answer "what did it find" from, short enough to never be a report read aloud. */
const MOST_ANSWER_CHARS = 1_500;

/** What the agent said to end its latest turn, whole, or null when it has said nothing yet. */
export function readLastAnswer(path: string): string | null {
  return lastAnswerIn(tailOf(path));
}

/** The agent's words after its last tool call in the latest turn, which is its answer to the person. */
export function lastAnswerIn(raw: string): string | null {
  let answer: string[] = [];
  for (const text of raw.split('\n')) {
    const entry = parsed(text);
    if (entry === null || entry.isSidechain === true || entry.isMeta === true) continue;
    const content = entry.message?.content;
    if (entry.type === 'user') {
      const said = typeof content === 'string' ? content : textBlocks(content).join('\n');
      if (ownWords(said) !== '') answer = [];
      continue;
    }
    if (entry.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const block of content as unknown[]) {
      if (block === null || typeof block !== 'object') continue;
      // Checked for an object just above; each field is narrowed before use.
      const part = block as Block;
      if (part.type === 'tool_use') answer = [];
      if (
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.trim() !== ''
      )
        answer.push(part.text.trim());
    }
  }
  const whole = answer.join('\n\n');
  return whole === '' ? null : clipped(whole, MOST_ANSWER_CHARS);
}

/** The test runs in the last stretch of a session, oldest first, for a watch on them. */
export function readTestRuns(path: string): TestRun[] {
  return testRunsIn(tailOf(path));
}

/** Each shell call that ran a test suite, paired with whether its result came back an error. */
export function testRunsIn(raw: string): TestRun[] {
  const asked = new Map<string, { at: string; command: string }>();
  const runs: TestRun[] = [];
  for (const text of raw.split('\n')) {
    const entry = parsed(text);
    if (entry === null || entry.isSidechain === true) continue;
    const at = typeof entry.timestamp === 'string' ? entry.timestamp : '';
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as unknown[]) {
      if (block === null || typeof block !== 'object') continue;
      // Checked for an object just above; each field is narrowed before use.
      const part = block as ToolBlock;
      const command = part.input?.command;
      if (
        part.type === 'tool_use' &&
        typeof part.id === 'string' &&
        typeof command === 'string'
      ) {
        if (isTestCommand(command))
          asked.set(part.id, { at, command: firstLine(command) });
      }
      const run =
        part.type === 'tool_result' ? asked.get(String(part.tool_use_id)) : undefined;
      if (run !== undefined)
        runs.push({ at, command: run.command, passed: !failed(part) });
    }
  }
  return runs;
}

/** What Claude Code writes in the person's place when they stop a turn, with or without a tool running. */
const INTERRUPTED = '[Request interrupted by user';
/** Its longest shell call is ten minutes, so a turn whose file sat still longer than this is not running. */
const STILL_TURN_MS = 15 * 60 * 1_000;

/**
 * Whether the session's latest turn is over by its own file, though no hook said so: stopped by
 * the person, failed on an API error, or untouched for longer than any step takes.
 */
export function readTurnOver(path: string, now: Date): boolean {
  try {
    if (now.getTime() - statSync(path).mtimeMs > STILL_TURN_MS) return true;
  } catch {
    // Gone: the hooks are all there is to go on.
    return false;
  }
  return turnOverIn(tailOf(path));
}

/** The last word in the main conversation: a reply that ended, an error, or the person stopping it. */
export function turnOverIn(raw: string): boolean {
  let over = false;
  for (const text of raw.split('\n')) {
    const entry = parsed(text);
    if (entry === null || entry.isSidechain === true || entry.isMeta === true) continue;
    if (entry.type === 'user') {
      const content = entry.message?.content;
      const said = typeof content === 'string' ? content : textBlocks(content).join('\n');
      over = said.trimStart().startsWith(INTERRUPTED);
    } else if (entry.type === 'assistant') {
      over =
        entry.isApiErrorMessage === true || entry.message?.stop_reason === 'end_turn';
    }
  }
  return over;
}

interface ToolBlock {
  type?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
  input?: { command?: unknown };
}

/** An error result, or one whose output opens with a non zero exit code. */
function failed(result: ToolBlock): boolean {
  if (result.is_error === true) return true;
  const output = typeof result.content === 'string' ? result.content : '';
  return /^Exit code [1-9]/.test(output);
}

function firstLine(command: string): string {
  return clipped(command.split('\n')[0] ?? command, MOST_TOOL_CHARS);
}

interface Entry {
  type?: unknown;
  timestamp?: unknown;
  /** Claude desktop's agent sessions stamp their log here instead. */
  _audit_timestamp?: unknown;
  /** A helper's turn inside Claude desktop's agent sessions, which is not the conversation. */
  parent_tool_use_id?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isApiErrorMessage?: unknown;
  message?: { content?: unknown; stop_reason?: unknown };
}

function linesOf(entry: Entry): ConversationLine[] {
  const stamp = entry.timestamp ?? entry._audit_timestamp;
  const at = typeof stamp === 'string' ? stamp : '';
  const content = entry.message?.content;
  if (entry.type === 'user') {
    const said = typeof content === 'string' ? content : textBlocks(content).join('\n');
    const person = ownWords(said);
    return person === ''
      ? []
      : [{ at, who: SPEAKER.PERSON, text: clipped(person, MOST_SAID_CHARS) }];
  }
  if (entry.type !== 'assistant' || !Array.isArray(content)) return [];
  return (content as unknown[]).flatMap((block) => agentLine(at, block));
}

interface Block {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
}

/** One block of the agent's reply: something it said, or a tool it ran. Thinking is never shown. */
function agentLine(at: string, block: unknown): ConversationLine[] {
  if (block === null || typeof block !== 'object') return [];
  // Checked for an object just above; each field is narrowed before use.
  const part = block as Block;
  if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '') {
    return [{ at, who: SPEAKER.AGENT, text: clipped(part.text.trim(), MOST_SAID_CHARS) }];
  }
  if (part.type === 'tool_use' && typeof part.name === 'string') {
    return [
      {
        at,
        who: SPEAKER.TOOL,
        text: clipped(toolLine(part.name, part.input), MOST_TOOL_CHARS),
      },
    ];
  }
  return [];
}

/** A tag the host wraps around what it adds, with everything inside it. */
const HOST_TAG = /<([a-z_-]+)[^>]*>[\s\S]*?<\/\1>/gi;

/** Taken off until none is left, so a tag inside another cannot survive the one pass that removed its outside. */
function withoutHostTags(said: string): string {
  let text = said;
  for (let before = ''; before !== text;) {
    before = text;
    text = text.replace(HOST_TAG, '');
  }
  return text;
}

/** What the person typed, without the tags and reminders the host wraps around it. */
function ownWords(said: string): string {
  return withoutHostTags(said)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('<'))
    .join(' ')
    .trim();
}

function textBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text);
}

/** A tool call as one line: its name and the one argument that says what it is for. */
function toolLine(name: string, input: unknown): string {
  const args =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  for (const key of [
    'description',
    'command',
    'file_path',
    'path',
    'pattern',
    'url',
    'query',
    'prompt',
  ]) {
    const value = args[key];
    if (typeof value !== 'string' || value === '') continue;
    const shown =
      key === 'file_path' || key === 'path'
        ? basename(value)
        : (value.split('\n')[0] ?? '');
    return `${name}: ${shown}`;
  }
  return name;
}

function clipped(text: string, most: number): string {
  return text.length <= most ? text : `${text.slice(0, most - 1)}…`;
}

function parsed(line: string): Entry | null {
  if (line.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(line);
    // A JSON object is all a transcript line is; anything else is skipped.
    return value !== null && typeof value === 'object' ? (value as Entry) : null;
  } catch {
    // A line cut where the tail began, or one still being written.
    return null;
  }
}

/** The first stretch of a file, since a session's opening request never moves from its start. */
function headOf(path: string, bytes: number = HEAD_BYTES): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const length = Math.min(fstatSync(fd).size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, 0);
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    // Gone or unreadable: the card says what else it knows of the session.
    return '';
  }
}

function tailOf(path: string, bytes: number = TAIL_BYTES): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    // Gone or unreadable: the window shows the rest of what it knows.
    return '';
  }
}
