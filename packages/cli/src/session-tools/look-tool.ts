import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DISPLAY,
  DisplayRequests,
  MEMNOX_HOME,
  type DisplayInput,
  type ShownIn,
  type Sight,
} from '@memnox/core';
import type { OperatorCall } from './operator-call';
import { liveRun, tabOf } from './run-tab';
import { runOfStart } from './start-memory';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * Looking at the person's screen: the brain asks, the Mac captures one window, reads its words and
 * its controls itself, and hands on the words. The picture leaves the Mac only when the brain needs
 * to see how something looks. The Mac never decides from words when to look.
 */

export const LOOK_TOOL: ToolDefinition = {
  name: 'look',
  description:
    'See what is on the person\'s screen right now: the window in front, or the app they named. It returns the words on it, read on their Mac, an outline of its buttons and fields, and what changed since you last looked at that app. Use it when they ask what is on their screen, what they are looking at, to read an error, what changed, or to check something they point at with "this" or "here", and before you say something you did is on screen. Pass visual "true" only when they ask how something looks, its layout, colours or a picture, since only then does the screenshot itself leave their Mac for you to read. It only looks and changes nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description:
          'the app to look at by its name, such as Safari; the window in front when left out',
      },
      session: {
        type: 'string',
        description:
          "a session's id to read its own terminal tab, wherever it is and without Screen Recording; use it to see what an agent is asking in its terminal, rather than naming its app",
      },
      visual: {
        type: 'string',
        description: '"true" only when how it looks matters, which sends the screenshot',
      },
    },
  },
  // It reads the screen and changes nothing anywhere.
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

/** Long enough to capture a window, walk its controls and read every word on it. */
const SIGHT_WAIT_MS = 15_000;
const SIGHT_POLL_MS = 150;

const NOT_SEEN =
  'The Mac did not answer with what is on screen. Say you could not see it just now, and never describe the screen from a guess.';

const OUTLINE_ONLY =
  'Memnox may not record the screen, so only the outline of the window came back. Answer from it, say once that you could not see the picture, and that turning on Screen Recording for Memnox in System Settings lets you.';

export const LOOK_CALLS: Readonly<Record<string, OperatorCall>> = {
  look: (deps, _seams, args) => lookTool(deps, args),
  forget_screen: (deps) => forgetScreenTool(deps),
};

async function lookTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const app = textArg(args, 'app');
  const session = textArg(args, 'session');
  // A start named by its own id reaches the run that came up for it, which is where its tab is.
  const run =
    session === undefined
      ? null
      : ((await liveRun(deps.home, session)) ?? (await runOfStart(deps.home, session)));
  const tab = tabOf(run);
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.LOOK,
    sessionId: session ?? 'screen',
    agent: 'memnox',
    title: app ?? tab?.app ?? '',
    ...lookInTab(run?.sessionId ?? session, tab),
    at: deps.now().toISOString(),
  });
  const sight = await (deps.seen ?? ((id: string) => awaitSight(deps.home, id)))(
    request.id,
  );
  if (sight === null) return { seen: false, said: NOT_SEEN };
  const visual = textArg(args, 'visual') === SAID_TRUE;
  const { image, ...read } = sight;
  // Read off somebody's screen, so a line on it asking for something is shown and never obeyed.
  return {
    seen: true,
    untrusted: true,
    ...read,
    ...(visual && image !== undefined ? { image } : {}),
    ...changedSince(deps.home, sight),
    // A tab read by script has its words and no picture, which is not a missing permission.
    ...(image === undefined && read.text === undefined ? { said: OUTLINE_ONLY } : {}),
  };
}

/**
 * A session's own tab, which the Mac reads by script when it is in iTerm or Terminal, so the words in
 * it come back without Screen Recording; its id is the mark that finds it when its device does not.
 */
export function lookInTab(
  session: string | undefined,
  tab: ShownIn | null,
): Pick<DisplayInput, 'tty' | 'appPath' | 'shownIn' | 'marks'> {
  if (session === undefined) return {};
  return {
    ...(tab?.tty === undefined ? {} : { tty: tab.tty }),
    ...(tab?.appPath === undefined ? {} : { appPath: tab.appPath }),
    ...(tab === null ? {} : { shownIn: tab }),
    marks: [session],
  };
}

/** How a tool argument says yes. */
const SAID_TRUE = 'true';

/** Enough lines to say what changed, never the whole window again. */
const MOST_CHANGED_LINES = 20;

/** The words last seen in each app, kept for this conversation only, so "what changed" has a before. */
const LAST_SEEN = new Map<string, string>();

/** The lines that came and went since this app was last looked at, or nothing the first time. */
function changedSince(home: string, sight: Sight): Record<string, unknown> {
  if (sight.text === undefined) return {};
  const key = `${home}\0${sight.app}`;
  const before = LAST_SEEN.get(key);
  LAST_SEEN.set(key, sight.text);
  if (before === undefined) return {};
  const was = new Set(lines(before));
  const now = new Set(lines(sight.text));
  return {
    changed: {
      appeared: [...now].filter((line) => !was.has(line)).slice(-MOST_CHANGED_LINES),
      gone: [...was].filter((line) => !now.has(line)).slice(-MOST_CHANGED_LINES),
    },
  };
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Where the Mac keeps what it looked at and what an action left behind, a day at most. */
const SCREEN_FOLDERS = ['sight', 'proof'] as const;

export const FORGET_SCREEN_TOOL: ToolDefinition = {
  name: 'forget_screen',
  description:
    'Delete every screenshot Memnox kept of their screen, what you looked at and the evidence of what was done, when they ask you to forget a screenshot or what was on their screen. Say in a few words that it is gone.',
  inputSchema: { type: 'object', properties: {} },
  // Deletes only Memnox's own captures in the person's home, and nothing an agent can do changes.
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
};

async function forgetScreenTool(deps: SessionToolDeps): Promise<unknown> {
  await Promise.all(
    SCREEN_FOLDERS.map((folder) =>
      rm(join(deps.home, MEMNOX_HOME, folder), { recursive: true, force: true }),
    ),
  );
  LAST_SEEN.clear();
  return { forgotten: true };
}

/** What the Mac saw for a LOOK, or null when it said nothing in time. */
export async function awaitSight(
  home: string,
  requestId: string,
  waitMs: number = SIGHT_WAIT_MS,
): Promise<Sight | null> {
  const requests = new DisplayRequests(home);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const sight = await requests.sightOf(requestId);
    if (sight !== null) return sight;
    await sleep(SIGHT_POLL_MS);
  }
  return null;
}
