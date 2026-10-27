import { SPEAKER, type ConversationLine } from '@memnox/core';
import { SessionViews } from '../daemon/session-view';
import { withEvents } from '../event-store';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { noteFocus } from './focus';
import { scopeOf } from './session-scope';

/**
 * Everything about one session in one call: its state and task, the latest of its
 * conversation, its last steps and the files it changed. One call where the brain used to make
 * three is most of the wait between a question and its answer.
 */
const LAST_ANSWER =
  'lastAnswer is what the agent told the person to end its latest turn, which is what it found or did. When they ask what it found, said or concluded, answer from it in a sentence or two of your own words: the finding first, never read out a list or its markdown.';

export async function sessionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null) return { ...scope, found: false };
  const views = new SessionViews(deps.home, deps.now);
  const [view, lastAnswer] = await Promise.all([
    views.view(scope.sessionId),
    views.lastAnswer(scope.sessionId),
  ]);
  if (view === null) return { ...scope, found: false };
  // The one just talked about is the one "it" and "the same session" mean next, not only one acted on.
  await noteFocus(deps, scope, 'asked about');
  const now = view.thinking ? nowIn(view.conversation ?? [], deps.now()) : null;
  return {
    ...scope,
    found: true,
    ...view,
    // Mid turn, the last answer is the previous turn's, so what it is doing now is told instead.
    ...(now !== null
      ? { now, said: NOW_DOING }
      : lastAnswer === null
        ? {}
        : { lastAnswer, untrusted: true, said: LAST_ANSWER }),
  };
}

const NOW_DOING =
  'It is in the middle of a turn. now says what they asked it this turn, how long ago, and the last thing it did and said since. When they ask what it is doing or what is happening, answer from now in a sentence or two: what it is working on, then what it is doing at this moment. Never describe an earlier turn as what it is doing.';

/** The turn in progress from its own transcript: the request that started it and the latest since. */
export function nowIn(
  lines: readonly ConversationLine[],
  moment: Date,
): Record<string, string> | null {
  const start = lastIndexOf(lines, SPEAKER.PERSON);
  if (start < 0) return null;
  const turn = lines.slice(start + 1);
  const asked = lines[start];
  const tool = turn[lastIndexOf(turn, SPEAKER.TOOL)];
  const said = turn[lastIndexOf(turn, SPEAKER.AGENT)];
  const minutes = Math.max(
    0,
    Math.round((moment.getTime() - Date.parse(asked?.at ?? '')) / 60_000),
  );
  return {
    asked: asked?.text ?? '',
    ...(Number.isFinite(minutes) ? { askedMinutesAgo: String(minutes) } : {}),
    ...(tool === undefined ? {} : { lastDid: tool.text }),
    ...(said === undefined ? {} : { lastSaid: said.text }),
  };
}

function lastIndexOf(lines: readonly ConversationLine[], who: string): number {
  for (let at = lines.length - 1; at >= 0; at -= 1) if (lines[at]?.who === who) return at;
  return -1;
}
