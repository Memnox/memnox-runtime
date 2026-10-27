/**
 * Cursor Agent asking "Run this command?" in its terminal, which no hook of its reports: Cursor asks unless
 * its own allowlist names the command, so the question is posted for the voice, dated a moment ahead so a
 * command run at once is cleared by its next hook before anybody hears it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { POST_KIND, SessionPosts, UNNAMED_SESSION } from '@memnox/core';

import { CURSOR_EVENT } from './agent-edits';
import { cwdOf, fieldsOf, sessionOf } from './hook-payload';
import { log } from './seam-runtime';

/** Long enough for a command Cursor runs unasked to be over, short enough to be news while it waits. */
const ASKING_AFTER_MS = 3_000;
/** Long enough to be answered on coming back, short enough that a stale one is never read out. */
const ASKING_HOURS = 1;
/** As much of a command as a person hears in one breath. */
const MOST_COMMAND_CHARS = 120;

/** Cursor's own config, for the person, and its own for the project. */
const CURSOR_CONFIG = ['.cursor', 'cli-config.json'] as const;
const PROJECT_CONFIG = ['.cursor', 'cli.json'] as const;

interface CursorPermissions {
  permissions?: { allow?: unknown; deny?: unknown };
}

interface CursorAskingContext {
  home: string;
  agent: string;
  runSession: string | undefined;
  now: () => Date;
}

/** Posts the question when Cursor will ask it; a reply of Memnox's own means Cursor never does. */
export async function noteCursorAsking(
  payload: unknown,
  replied: boolean,
  context: CursorAskingContext,
): Promise<void> {
  await postCursorAsking(payload, replied, context).catch((err: unknown) => {
    // The voice reading it out is a convenience: Cursor's own prompt is still on screen.
    log(`cursor question failed: ${String(err)}`);
  });
}

async function postCursorAsking(
  payload: unknown,
  replied: boolean,
  context: CursorAskingContext,
): Promise<void> {
  const hook = fieldsOf(payload);
  if (replied || hook === null || hook['hook_event_name'] !== CURSOR_EVENT.BEFORE_SHELL)
    return;
  const command = typeof hook['command'] === 'string' ? hook['command'].trim() : '';
  if (command === '') return;
  const rules = await cursorRules(context.home, cwdOf(hook));
  if (rules.allow.some((each) => names(each, command))) return;
  // A command it refuses outright is refused without a question.
  if (rules.deny.some((each) => names(each, command))) return;
  const own = sessionOf(hook);
  await new SessionPosts(context.home).put(
    {
      kind: POST_KIND.ASKING,
      sessionId: context.runSession ?? (own === '' ? UNNAMED_SESSION : own),
      agent: context.agent,
      summary: `It is waiting on you in its terminal: "Run this command? ${command.slice(0, MOST_COMMAND_CHARS)}". Pressing y runs it once, n skips it`,
      at: new Date(context.now().getTime() + ASKING_AFTER_MS).toISOString(),
    },
    ASKING_HOURS,
  );
}

/** The Shell entries Cursor allows and denies, the person's and the project's together. */
async function cursorRules(
  home: string,
  cwd: string | undefined,
): Promise<{ allow: string[]; deny: string[] }> {
  const files = [join(home, ...CURSOR_CONFIG)];
  if (cwd !== undefined) files.push(join(cwd, ...PROJECT_CONFIG));
  const read = await Promise.all(files.map(readPermissions));
  return {
    allow: read.flatMap((each) => shellEntries(each?.permissions?.allow)),
    deny: read.flatMap((each) => shellEntries(each?.permissions?.deny)),
  };
}

/** Whether an entry such as `git status` or `*` covers the command, as Cursor matches it by its start. */
export function names(entry: string, command: string): boolean {
  return entry === '*' || command === entry || command.startsWith(`${entry} `);
}

async function readPermissions(path: string): Promise<CursorPermissions | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CursorPermissions;
  } catch {
    // No config, or one it cannot read, allows nothing of its own.
    return null;
  }
}

/** `Shell(git status)` read as `git status`; any other kind of entry is not about commands. */
function shellEntries(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((each): each is string => typeof each === 'string')
    .map((each) => /^Shell\((.*)\)$/.exec(each.trim())?.[1]?.trim() ?? '')
    .filter((each) => each !== '');
}
