import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { DISPLAY, DisplayRequests, SessionHosts, wentIn } from '@memnox/core';
import { isAgentProgram } from './agent-foreground';
import { liveHost } from './live-host';
import { sessionMarks } from './session-marks';
import { closePane, paneOn, type Pane } from './multiplexer';
import type { SessionToolDeps } from './read-tools';
import { witnessed } from './witnessed';
import type { SessionScope } from './session-scope';
import { processAlive } from './sessions-tool';
import { CLOSES_CLEANLY, FINDS_ITS_TAB } from './session-tools.constants';

/**
 * Closing a session wherever it runs. iTerm and an editor's terminal close the tab itself; a tmux
 * or WezTerm pane is closed through its own command line; anywhere else the agent is ended first,
 * as closing its tab would, and the tab left behind is tidied away where the Mac can find it.
 */

export async function closeSessionNow(
  deps: SessionToolDeps,
  scope: SessionScope,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const recorded = await new SessionHosts(deps.home).read(sessionId);
  const live = recorded === null ? null : liveHost(recorded);
  const app = live?.app ?? live?.appPath ?? '';
  const end = deps.endAgent ?? endAgent;
  // An editor's agent panel has no tab to close, and ending its agent ends the session it holds.
  if (live?.panel === true) {
    if (!(await end(live.pid))) return { closed: false, said: NOT_CLOSED };
    await closedNow(deps, sessionId);
    return { closed: true, said: PANEL_ENDED };
  }
  const tty = live?.tty;
  const pane =
    tty === undefined || FINDS_ITS_TAB.test(app) ? null : paneOn(tty, deps.panes);
  if (pane !== null) return closedPane(deps, sessionId, pane);
  // Terminal and other terminal apps ask before closing a tab with a program running in it.
  const ended =
    live !== null &&
    tty !== undefined &&
    !CLOSES_CLEANLY.test(app) &&
    (await end(live.pid));
  return closedThroughMac(deps, {
    scope,
    sessionId,
    marks: await sessionMarks(deps, sessionId, live),
    ...(tty === undefined ? {} : { tty }),
    ended,
  });
}

async function closedPane(
  deps: SessionToolDeps,
  sessionId: string,
  pane: Pane,
): Promise<Record<string, unknown>> {
  if (!closePane(pane, deps.panes)) {
    return {
      closed: false,
      why: `${pane.multiplexer} would not close its pane`,
      said: NOT_CLOSED,
    };
  }
  await closedNow(deps, sessionId);
  return { closed: true, said: CLOSED };
}

interface MacClose {
  scope: SessionScope;
  sessionId: string;
  /** Lines only its tab shows, for a terminal app that cannot say which tab is whose. */
  marks: string[];
  tty?: string;
  /** The agent was already ended, so the session is over whatever becomes of its tab. */
  ended: boolean;
}

async function closedThroughMac(
  deps: SessionToolDeps,
  { scope, sessionId, tty, ended, marks }: MacClose,
): Promise<Record<string, unknown>> {
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.CLOSE,
    sessionId,
    agent: scope.agent,
    title: CLOSE_TITLE,
    marks,
    ...(tty === undefined ? {} : { tty }),
    at: deps.now().toISOString(),
  });
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  const why = {
    ...(delivery?.reason === undefined ? {} : { why: delivery.reason }),
    ...witnessed(delivery),
  };
  if (delivery !== null && wentIn(delivery.outcome)) {
    await closedNow(deps, sessionId);
    return { closed: true, ...why, said: CLOSED };
  }
  if (ended) {
    await closedNow(deps, sessionId);
    return { closed: true, ...why, said: ENDED_TAB_LEFT };
  }
  if (delivery === null) return { closed: true, said: CLOSE_UNCONFIRMED };
  return { closed: false, ...why, said: NOT_CLOSED };
}

/** Closed on purpose, which is recorded so its end is never told as one it did not choose. */
async function closedNow(deps: SessionToolDeps, sessionId: string): Promise<void> {
  await new SessionHosts(deps.home).end(sessionId, deps.now().toISOString());
}

/** A hang up first, as closing its terminal sends, then a terminate for an agent that ignored it. */
const END_SIGNALS = ['SIGHUP', 'SIGTERM'] as const;

/** What the Mac's card is headed while it closes the session. */
const CLOSE_TITLE = 'Session';

/** Long enough for an agent to save its conversation and go after a hang up. */
const EXIT_LOOKS = 15;
const EXIT_POLL_MS = 200;

/**
 * Ends the agent as closing its terminal would, with a hang up and then a terminate, and only when
 * the process is still an agent, since a number reused by another program must never be signalled.
 */
async function endAgent(pid: number): Promise<boolean> {
  if (!processAlive(pid)) return true;
  if (!isAgentProgram(commandOf(pid))) return false;
  for (const signal of END_SIGNALS) {
    try {
      process.kill(pid, signal);
    } catch {
      return !processAlive(pid);
    }
    for (let look = 0; look < EXIT_LOOKS; look += 1) {
      await sleep(EXIT_POLL_MS);
      if (!processAlive(pid)) return true;
    }
  }
  return false;
}

function commandOf(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const CLOSED =
  'Its live window and its terminal tab are closed, which ended the agent there; its conversation is kept and can be resumed. Say it is closed in a few words.';
const PANEL_ENDED =
  'Its agent is ended, so the session is over and does nothing more, and its conversation is kept; its panel in the editor stays open showing it. Say it is closed in a few words.';
const ENDED_TAB_LEFT =
  'Its agent is ended, so the session is over and its conversation is kept, but its tab is still open at a shell prompt: why says why. Say exactly that in one sentence.';
const CLOSE_UNCONFIRMED =
  'Handed to the Mac to close its window and tab, which has not confirmed yet. Say you are closing it; never that it is closed.';
const NOT_CLOSED =
  'Nothing was closed and it is still running: why says the reason. Say that in one sentence, the reason in plain words, and offer to stop it instead, which presses Escape. When closing several, say it once for all of them together.';
