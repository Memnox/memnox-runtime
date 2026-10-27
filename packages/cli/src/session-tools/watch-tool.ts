import {
  minutesToMs,
  SessionWatches,
  UNNAMED_SESSION,
  VoiceFocusStore,
  WATCH_FOR,
  type VoiceFocus,
  type WatchFor,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { FOCUS_STARTED, noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { scopeOf } from './session-scope';

/**
 * "Tell me when the tests pass": a watch on one session that speaks up once, when it happens.
 * It changes nothing an agent can do, so it is set at once, with no confirmation.
 */

const WATCHABLE: readonly string[] = Object.values(WATCH_FOR);

const SET =
  'Set. You will be told out loud when it happens, even if they walk away. Say so in a few words, like "I will tell you when the tests pass."';

export async function watchForTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const asked = textArg(args, 'for') ?? WATCH_FOR.FINISHED;
  if (!WATCHABLE.includes(asked)) {
    return {
      watching: false,
      said: `for is one of ${WATCHABLE.join(', ')}, not "${asked}".`,
    };
  }
  const named = textArg(args, 'session');
  const started = named === undefined ? await justStarted(deps) : null;
  if (started !== null)
    return awaitStarted(deps, started, asked as WatchFor, textArg(args, 'said'));
  const scope = await withEvents(deps.home, (store) => scopeOf(store, deps, named));
  if (scope.sessionId === null || scope.sessionId === UNNAMED_SESSION) {
    return { ...scope, watching: false, said: 'No agent session was found to watch.' };
  }
  const said = textArg(args, 'said');
  const watch = await new SessionWatches(deps.home).set({
    sessionId: scope.sessionId,
    agent: scope.agent,
    for: asked as WatchFor, // narrowed by the includes check above
    ...(said === undefined ? {} : { said }),
    at: deps.now().toISOString(),
  });
  await noteFocus(deps, scope, 'watched');
  return { ...scope, watching: true, watch: watch.id, for: watch.for, said: SET };
}

/** Long enough for an agent to start and take its first step; past it, "it" is no longer the new one. */
const JUST_STARTED_MS = minutesToMs(15);

const WAITING =
  'Set. The session was only just started and has not acted yet, so the watch waits for it and you will be told out loud when it happens. Say so in a few words, like "I will tell you when it finishes."';

/** The session the voice started a moment ago, which has no id until its agent first acts. */
async function justStarted(deps: SessionToolDeps): Promise<VoiceFocus | null> {
  const focus = await new VoiceFocusStore(deps.home).read().catch(() => null);
  if (focus?.why !== FOCUS_STARTED || focus.repository === undefined) return null;
  const age = Date.parse(deps.now().toISOString()) - Date.parse(focus.at);
  return age >= 0 && age < JUST_STARTED_MS ? focus : null;
}

async function awaitStarted(
  deps: SessionToolDeps,
  started: VoiceFocus,
  asked: WatchFor,
  said: string | undefined,
): Promise<unknown> {
  const watch = await new SessionWatches(deps.home).set({
    sessionId: '',
    agent: started.agent ?? 'agent',
    for: asked,
    ...(said === undefined ? {} : { said }),
    awaiting: { repository: started.repository ?? '', since: started.at },
    at: deps.now().toISOString(),
  });
  return {
    watching: true,
    watch: watch.id,
    for: watch.for,
    waitingForStart: true,
    said: WAITING,
  };
}
