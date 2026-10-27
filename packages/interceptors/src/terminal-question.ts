/**
 * Claude Code stopping in its own terminal to ask its person something, a permission or a choice:
 * posted so the voice reads it out and answers it there, and taken back by the session's next hook,
 * since any hook after it means the question was answered.
 */
import { POST_KIND, SessionPosts, UNNAMED_SESSION } from '@memnox/core';

import { EDIT_HOOK_EVENT } from './edit-hook';
import { fieldsOf, firstText, sessionOf, type HookFields } from './hook-payload';

/** The notifications that wait on the person, as against one saying a turn ended or a sign in worked. */
const ASKING_TYPES: readonly string[] = ['permission_prompt', 'elicitation_dialog'];

/** Long enough to be answered on coming back, short enough that a stale one is never read out. */
const ASKING_HOURS = 1;

/** As much of the agent's own words as a person hears in one breath. */
const MOST_MESSAGE_CHARS = 200;

interface TerminalQuestionContext {
  home: string;
  agent: string;
  runSession: string | undefined;
  now: () => Date;
}

/** True when the payload was Claude Code's notification, which nothing else in the hook answers. */
export async function noteTerminalQuestion(
  payload: unknown,
  context: TerminalQuestionContext,
): Promise<boolean> {
  const hook = fieldsOf(payload);
  if (hook === null || hook['hook_event_name'] !== EDIT_HOOK_EVENT.NOTIFICATION)
    return false;
  const kind = firstText(hook, ['notification_type']);
  if (kind === undefined || !ASKING_TYPES.includes(kind)) return true;
  const message = (firstText(hook, ['message']) ?? 'a question').slice(
    0,
    MOST_MESSAGE_CHARS,
  );
  await new SessionPosts(context.home).put(
    {
      kind: POST_KIND.ASKING,
      sessionId: sessionFor(hook, context),
      agent: context.agent,
      summary: `It is waiting on you in its terminal: "${message}"`,
      at: context.now().toISOString(),
    },
    ASKING_HOURS,
  );
  return true;
}

/** Any other hook of the session means its question was answered, so it is no longer read out. */
export async function clearTerminalQuestion(
  payload: unknown,
  context: TerminalQuestionContext,
): Promise<void> {
  const hook = fieldsOf(payload);
  if (hook === null) return;
  await new SessionPosts(context.home).remove(
    POST_KIND.ASKING,
    sessionFor(hook, context),
  );
}

function sessionFor(hook: HookFields, context: TerminalQuestionContext): string {
  const own = sessionOf(hook);
  return context.runSession ?? (own === '' ? UNNAMED_SESSION : own);
}
