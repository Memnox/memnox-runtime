import {
  AGENT_ID,
  DISPLAY,
  DisplayRequests,
  RunTerminals,
  wentIn,
  type RunTerminal,
} from '@memnox/core';
import { claudeTrusts, TRUST_QUESTION, TRUST_YES_KEYS } from './claude-trust';
import { onlyTheFolder, trustKeys } from './folder-trust';
import { FOCUS_STARTED, noteFocus } from './focus';
import { awaitSight, lookInTab } from './look-tool';
import { tabOf } from './run-tab';
import type { SessionToolDeps } from './read-tools';

/**
 * A start whose agent never showed itself running: `memnox run` came up in its tab, so the agent is
 * most likely stopped on a question of its own before its first hook, such as whether to trust the
 * folder. The tab is read so the voice can put that question to the person rather than wait.
 */

/** The end of a terminal is where its question is, and enough of it to hold every choice. */
const MOST_SCREEN_CHARS = 1_200;

export async function questionBeforeStart(
  deps: SessionToolDeps,
  repository: string,
  since: string,
): Promise<Record<string, unknown>> {
  const run = await new RunTerminals(deps.home).startedIn(repository, since);
  if (run === null) return {};
  const screen = await screenOf(deps, run);
  if (screen !== undefined && screen !== '') {
    // The folder they asked for, so its trust question is answered for them and nothing else is.
    const keys = trustKeys(screen);
    const answered = keys === null ? null : await trustForThem(deps, run, keys);
    return answered ?? { session: run.sessionId, screen, said: ASKING_FIRST };
  }
  // The tab could not be read, which is most Macs before Screen Recording is on, so Claude Code's
  // own record says whether the question in it is the one it asks everywhere it has never opened.
  const trusted =
    run.agent === AGENT_ID.CLAUDE_CODE ? await claudeTrusts(deps.home, repository) : true;
  if (trusted === true) return { session: run.sessionId, said: UP_NOT_READ };
  // Unseen, it is answered only when the folder brings no permissions, servers or hooks of its own to accept.
  const answered = onlyTheFolder(repository)
    ? await trustForThem(deps, run, TRUST_YES_KEYS.split(' '))
    : null;
  if (answered !== null) return answered;
  return {
    session: run.sessionId,
    question: TRUST_QUESTION,
    answerYes: TRUST_YES_KEYS,
    said: TRUST_UNREAD,
  };
}

/** The end of the run's tab as the Mac read it, or undefined when it could not be read. */
async function screenOf(
  deps: SessionToolDeps,
  run: RunTerminal,
): Promise<string | undefined> {
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.LOOK,
    sessionId: run.sessionId,
    agent: run.agent,
    title: run.app ?? '',
    // Read from the tab itself, which needs no Screen Recording and never looks at another app.
    ...lookInTab(run.sessionId, tabOf(run)),
    at: deps.now().toISOString(),
  });
  const sight = await (deps.seen ?? ((id: string) => awaitSight(deps.home, id)))(
    request.id,
  );
  return sight?.text?.trim().slice(-MOST_SCREEN_CHARS);
}

/**
 * The keys that say yes to trusting the folder, pressed in the run's own tab, and whether the agent
 * then came up; null when they could not be pressed, so the question goes to the person instead.
 */
async function trustForThem(
  deps: SessionToolDeps,
  run: RunTerminal,
  keys: readonly string[],
): Promise<Record<string, unknown> | null> {
  const tab = tabOf(run);
  if (tab === null) return null;
  const moment = deps.now().toISOString();
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.PRESS,
    sessionId: run.sessionId,
    agent: run.agent,
    title: keys.join(' '),
    text: keys.join(' '),
    tty: tab.tty,
    ...(run.appPath === undefined ? {} : { appPath: run.appPath }),
    shownIn: tab,
    // Its id is in the banner memnox run printed in that tab, which finds it when its device does not.
    marks: [run.sessionId],
    at: moment,
  });
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  if (delivery !== null && !wentIn(delivery.outcome)) return null;
  const up = deps.startSeen === undefined ? null : await deps.startSeen(run.cwd, moment);
  if (up === null)
    return { session: run.sessionId, trustedFolder: true, said: TRUSTED_NOT_UP };
  await noteFocus(
    deps,
    { sessionId: up, repository: run.cwd, agent: run.agent },
    FOCUS_STARTED,
  );
  return {
    session: up,
    trustedFolder: true,
    confirmed: true,
    said: TRUSTED_UP,
  };
}

const TRUSTED_UP =
  'It asked whether to trust the folder before it started, and since they asked for it there, you said yes for them, and the agent is now starting on the task. Say in a few words that it is running there, like "Codex is working in studiolabs.", and offer to tell them when it finishes; mention the folder question only if they ask.';
const TRUSTED_NOT_UP =
  'It asked whether to trust the folder before it started, and since they asked for it there, you said yes for them, but it has not shown itself running yet. Say in one sentence that you answered its folder question and it has not come up yet, and offer to look; never say it is working.';
const ASKING_FIRST =
  'The agent came up in its tab but has not started its session: screen is what its tab shows now. When it shows a question with choices, such as whether to trust this folder with the permissions it brings, say in one sentence what it asks and the choices, plainly, like "Claude Code is asking whether you trust the studiolabs folder before it starts. Shall I say yes?", and on their answer call answer_agent with this session and the keys that pick what they chose. Never answer it yourself. When it shows no question, say it has not come up yet and they can ask you to check.';
const TRUST_UNREAD =
  'The agent came up in its tab but has not started its session, and its tab could not be read. Claude Code was never told to trust this folder, and it asks that before it starts anywhere it has not, so question is what its tab is showing. Say in one sentence that Claude Code is asking whether to trust the folder before it starts, and ask whether to say yes; on their yes call answer_agent with this session and the keys in answerYes. Never answer it yourself.';
const UP_NOT_READ =
  'The agent came up in its tab but has not started its session, and its tab could not be read. Say in one sentence that it may be asking something in its terminal before it starts, and offer to look.';
