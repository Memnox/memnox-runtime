import {
  DISPLAY,
  DisplayRequests,
  RunTerminals,
  SessionHosts,
  terminalKeys,
  wentIn,
  type RunTerminal,
  type DisplayRequest,
  type SessionHost,
  type ShownIn,
} from '@memnox/core';
import { liveHost } from './live-host';
import { liveRun, tabOf } from './run-tab';
import { unlessMacTold } from './mac-told';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';
import { witnessed } from './witnessed';

/**
 * Answering a question an agent asks in its own terminal, such as whether to trust a folder or
 * whether to run a command, by pressing the keys that pick what the person chose, in that tab only.
 */

export const ANSWER_AGENT_TOOL: ToolDefinition = {
  name: 'answer_agent',
  description:
    'Answer a question an agent shows in its own terminal, such as "Do you trust this folder?" or "Do you want to proceed?", with the choice the person just said, by pressing keys in that session\'s tab only. Use it after a start or a look showed the question and you asked them; never pick an answer they did not give. Pass keys as the key names that select their choice and confirm it, separated by spaces, from up, down, left, right, enter, escape, tab, space, or one letter or digit: to pick the second line of a list with the first selected, "down enter"; for a numbered choice, its number then "enter" only when the screen asks for Enter.',
  inputSchema: {
    type: 'object',
    properties: {
      session: {
        type: 'string',
        description: 'the session id the start or the session list gave',
      },
      keys: {
        type: 'string',
        description: 'the keys to press in order, like "down enter" or "1"',
      },
    },
  },
  // It presses only keys, only in the agent's own tab, and only with the person's answer.
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

export const ANSWER_AGENT_CALLS: Readonly<Record<string, OperatorCall>> = {
  answer_agent: (deps, _seams, args) => answerAgentTool(deps, args),
};

async function answerAgentTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const sessionId = textArg(args, 'session');
  const keys = terminalKeys(textArg(args, 'keys') ?? '');
  if (keys === null) return { answered: false, said: NOT_KEYS };
  if (sessionId === undefined) return { answered: false, said: NO_SESSION };
  const { live, run, tab } = await whereItAsks(deps, sessionId);
  if (live?.tty === undefined || live.panel === true)
    return { answered: false, said: NO_TERMINAL };
  const moment = deps.now().toISOString();
  const tty = live.tty;
  const request = await pressIn(deps, {
    sessionId,
    keys,
    live: { ...live, tty },
    tab,
    moment,
  });
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  if (delivery !== null && !wentIn(delivery.outcome))
    return {
      answered: false,
      ...(delivery.reason === undefined ? {} : { why: delivery.reason }),
      said: unlessMacTold(delivery, NOT_PRESSED),
      ...witnessed(delivery),
    };
  const started =
    run !== null && deps.startSeen !== undefined
      ? await deps.startSeen(run.cwd, moment)
      : undefined;
  return {
    answered: true,
    ...(typeof started === 'string' ? { session: started } : {}),
    said:
      started === undefined ? PRESSED : started === null ? PRESSED_NOT_UP : PRESSED_UP,
    ...witnessed(delivery),
  };
}

/** The keys asked of the Mac, for that tab only. */
function pressIn(
  deps: SessionToolDeps,
  press: {
    sessionId: string;
    keys: readonly string[];
    live: SessionHost & { tty: string };
    tab: ShownIn | null;
    moment: string;
  },
): Promise<DisplayRequest> {
  const { sessionId, keys, live, tab, moment } = press;
  return new DisplayRequests(deps.home).request({
    display: DISPLAY.PRESS,
    sessionId,
    agent: live.agent,
    title: keys.join(' '),
    text: keys.join(' '),
    tty: live.tty,
    ...(live.appPath === undefined ? {} : { appPath: live.appPath }),
    ...(tab === null ? {} : { shownIn: tab }),
    // Its id is in the banner memnox run printed in that tab, which finds it when its device does not.
    marks: [sessionId],
    at: moment,
  });
}

/**
 * The tab the question is in, and the run that noted it when the agent has not reached its first
 * hook. A live run's own tab wins over the hooked one, which an agent that keeps a terminal of its
 * own for its tools may have been noted on.
 */
async function whereItAsks(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<{ live: SessionHost | null; run: RunTerminal | null; tab: ShownIn | null }> {
  const [hooked, run, ran] = await Promise.all([
    new SessionHosts(deps.home).read(sessionId),
    new RunTerminals(deps.home).read(sessionId),
    liveRun(deps.home, sessionId),
  ]);
  const tab = tabOf(ran);
  if (hooked !== null) {
    const live = liveHost(hooked);
    return {
      live: live === null || tab === null ? live : { ...live, ...tab },
      run: null,
      tab,
    };
  }
  // A run read its own tab as it started, so only whether it still runs is asked again.
  return { live: ran === null ? null : { ...ran, seenAt: ran.startedAt }, run, tab };
}

const NOT_KEYS =
  'Those are not keys it can press. Pass key names only, such as "down enter" or "1", and try again.';
const NO_SESSION =
  'Pass the session whose question it is, from the start or the session list.';
const NO_TERMINAL =
  'That session is not in a terminal tab it can find, so its question cannot be answered from here. Say so in one sentence and offer to bring its window forward.';
const NOT_PRESSED =
  'The keys did not go in. Say sorry in a few words and say why in plain words; the agent is still waiting on its question.';
const PRESSED =
  'The answer went into its tab. Say in a few words that you answered it, never that the agent is working until something shows it.';
const PRESSED_UP =
  'The answer went in and the agent has started its session. Say so in a few words, like "Done, Claude Code is running in studiolabs.", and offer to tell them when it finishes.';
const PRESSED_NOT_UP =
  'The answer went in, but the agent has not started its session yet, so it may be asking something else. Offer to look at its tab.';
