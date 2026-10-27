import {
  CARD_FILES,
  wentIn,
  DISPLAY,
  DisplayRequests,
  isStartableAgent,
  LEDGER_SESSION_LIMIT,
  SessionHosts,
  SessionTasks,
  SessionTurns,
  type CardExcerpt,
  type CardFile,
  type DisplayKind,
  type SessionHost,
  type ShownIn,
  VoiceFocusStore,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { changesTool, repositoriesOf } from './changes-tool';
import { mainCheckoutOf } from './main-checkout';
import { FOCUS_STARTED, noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { RewindSeams } from './rewind-tool';
import { resolveInstalledApp } from './app-tools';
import { scopeOf, type SessionScope } from './session-scope';
import { stopSession } from './stop-tool';
import { closeSessionNow } from './close-tool';
import { liveHost } from './live-host';
import { sessionMarks } from './session-marks';
import { placeBeforeHook, type PlaceBeforeHook } from './start-memory';
import { paneOn, showPane } from './multiplexer';
import {
  APP_SESSION_PREFIX,
  FINDS_ITS_TAB,
  SAID,
  TOOL_ARG,
} from './session-tools.constants';

/**
 * Shows the person a session: its own window brought forward, or a card with its summary in
 * the corner of the screen. It changes nothing an agent can do, so it waits on nobody.
 */

/**
 * What the brain may ask for, and what the Mac is asked to do. "Open" takes the person to the
 * session itself, as anybody saying it means; the live window is only ever asked for as "watch".
 * Typing an instruction is the instruct tool's, never this one's.
 */
const DISPLAYS: Readonly<Record<string, DisplayKind>> = {
  open: DISPLAY.FOCUS,
  focus: DISPLAY.FOCUS,
  watch: DISPLAY.OPEN,
  card: DISPLAY.CARD,
  close: DISPLAY.CLOSE,
  stop: DISPLAY.INTERRUPT,
};

/** How the brain asks for every session at once, which names no session. */
const ALL = 'all';

/** How the brain clears its own cards and windows, which names no session and ends nothing. */
const DISMISS = 'dismiss';

/** A start's id or a display request's id, which the brain passes for a session it just started. */
const NOT_A_SESSION = ['stt_', 'dsp_'] as const;

/** What a card is headed when the brain gave it no title. */
const DEFAULT_TITLE = 'Session';

export async function showTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  args: ToolArgs,
): Promise<unknown> {
  const asked = textArg(args, 'display') ?? DISPLAY.CARD;
  if (asked === ALL || asked === DISMISS) return withoutSession(deps, args, asked);
  const display = displayOf(asked);
  if (display === null) {
    return {
      shown: false,
      said: `display is "open", "watch", "card", "stop", "close", "dismiss" or "all", not "${asked}".`,
    };
  }
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null) return { ...scope, shown: false };
  if (display === DISPLAY.CLOSE)
    return closeSession(
      deps,
      scope,
      scope.sessionId,
      textArg(args, TOOL_ARG.NOW) === SAID.YES,
    );
  if (display === DISPLAY.INTERRUPT) return stopSession(deps, scope, scope.sessionId);
  return putUp(deps, seams, { scope, sessionId: scope.sessionId, display, args });
}

interface Showing {
  scope: SessionScope;
  sessionId: string;
  display: DisplayKind;
  args: ToolArgs;
}

/** The session put on screen as asked, and what the brain may say of it. */
async function putUp(
  deps: SessionToolDeps,
  seams: RewindSeams,
  { scope, sessionId, display, args }: Showing,
): Promise<unknown> {
  const text = textArg(args, 'text');
  if (display === DISPLAY.CARD && text === undefined) {
    return { shown: false, said: 'A card needs text: the summary you are about to say.' };
  }
  const { host, openAt, early } = await whereItRuns(deps, sessionId);
  // A session in an agent's own desktop app has no tab or folder, so the app itself is what comes forward.
  const appPath =
    host === null ? (desktopAppOf(deps, sessionId) ?? early?.appPath ?? null) : null;
  const code = display === DISPLAY.CARD ? await codeFor(deps, seams, sessionId) : {};
  const shownIn = display === DISPLAY.FOCUS ? paneShownIn(deps, host) : null;
  const marks =
    display === DISPLAY.FOCUS
      ? [...(await sessionMarks(deps, sessionId, host)), ...(early?.marks ?? [])]
      : [];
  const request = await new DisplayRequests(deps.home).request({
    ...code,
    ...(shownIn === null ? {} : { shownIn }),
    marks,
    display,
    sessionId: sessionId,
    agent: scope.agent,
    title: textArg(args, 'title') ?? DEFAULT_TITLE,
    ...(text === undefined ? {} : { text }),
    ...(openAt === undefined ? {} : { cwd: openAt }),
    ...(appPath === null ? {} : { appPath }),
    // The tab its run noted, for a session whose agent has not acted yet and so has no host.
    ...(early?.tty === undefined ? {} : { tty: early.tty }),
    at: deps.now().toISOString(),
  });
  const [showing, failed] = await Promise.all([
    aboutSession(deps, sessionId),
    display === DISPLAY.FOCUS ? notBroughtForward(deps, request.id) : null,
  ]);
  await noteFocus(deps, scope, 'opened');
  if (failed !== null) return { ...scope, showing, ...failed };
  return { ...scope, showing, ...shownAs(display, host?.app), ...onCard(code) };
}

/** For a session in a tmux or WezTerm pane, the pane selected and the terminal it is seen in. */
function paneShownIn(deps: SessionToolDeps, host: SessionHost | null): ShownIn | null {
  const live = host === null ? null : liveHost(host);
  const app = live?.app ?? live?.appPath ?? '';
  if (live?.tty === undefined || FINDS_ITS_TAB.test(app)) return null;
  const pane = paneOn(live.tty, deps.panes);
  return pane === null ? null : showPane(pane, deps.panes);
}

/** A few seconds, since bringing a window forward is quick and the voice is waiting to speak. */
const FOCUS_WAIT_MS = 6_000;

/**
 * What the Mac said when it could not bring the session forward, or null when it did or said
 * nothing in time, so "it is open" is never said of a window that never came up.
 */
async function notBroughtForward(
  deps: SessionToolDeps,
  requestId: string,
): Promise<Record<string, unknown> | null> {
  const delivery = (await deps.delivered?.(requestId, FOCUS_WAIT_MS)) ?? null;
  if (delivery === null || wentIn(delivery.outcome)) return null;
  return {
    shown: false,
    ...(delivery.reason === undefined ? {} : { why: delivery.reason }),
    said: NOT_OPENED,
  };
}

const NOT_OPENED =
  'Its window did not come forward: why says the reason. Never say it is open or on screen. Say sorry in a few words, the reason in plain words, and offer to watch it live instead, which always opens.';

/**
 * Closes its live window and its own terminal tab. A turn in progress is cut off only when the
 * person said so, since closing the tab ends the agent; its conversation is kept either way.
 */
async function closeSession(
  deps: SessionToolDeps,
  scope: SessionScope,
  sessionId: string,
  now: boolean,
): Promise<unknown> {
  const showing = await aboutSession(deps, sessionId);
  if (showing['turn'] === 'in progress' && !now)
    return { ...scope, closed: false, said: MID_TURN };
  return { ...scope, showing, ...(await closeSessionNow(deps, scope, sessionId)) };
}

const MID_TURN =
  'Nothing was closed yet: it is in the middle of a turn, and closing its tab ends the agent there, though its conversation is kept. Ask once, in one short question, whether to stop it first and keep the tab, which is show with display stop, or close it now anyway, which is show with display close and now "true"; do which they say at once. Never refuse it twice.';

/** What names no session: every session up at once, or every card and window taken down. */
function withoutSession(
  deps: SessionToolDeps,
  args: ToolArgs,
  asked: string,
): Promise<unknown> {
  return asked === ALL ? showAll(deps, args) : dismissAll(deps);
}

/** Every Memnox card and window off the screen at once; no agent and no tab is touched. */
async function dismissAll(deps: SessionToolDeps): Promise<unknown> {
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.DISMISS,
    sessionId: ALL,
    agent: 'memnox',
    title: 'Dismiss',
    at: deps.now().toISOString(),
  });
  return { dismissed: true, said: DISMISSED };
}

const DISMISSED =
  'Every Memnox card and window is off their screen; every agent and its tab is still running. Say it is cleared in a few words.';

/** Every session as its own card, together; the Mac reads the sessions itself, so nothing is copied here. */
async function showAll(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.SESSIONS,
    sessionId: ALL,
    agent: 'memnox',
    title: textArg(args, 'title') ?? 'Your sessions',
    at: deps.now().toISOString(),
  });
  return { shown: true, display: DISPLAY.SESSIONS, said: ALL_SHOWN };
}

function onCard(code: { files?: CardFile[] }): { filesOnCard?: number } {
  return code.files === undefined ? {} : { filesOnCard: code.files.length };
}

function displayOf(asked: string): DisplayKind | null {
  return Object.hasOwn(DISPLAYS, asked) ? (DISPLAYS[asked] ?? null) : null;
}

/** What was put up, so the brain names the session it showed rather than the one it meant to. */
async function aboutSession(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const [task, turn, rows] = await Promise.all([
    new SessionTasks(deps.home).read(sessionId),
    new SessionTurns(deps.home).read(sessionId),
    withEvents(deps.home, (store) =>
      store.query({ sessionId, limit: LEDGER_SESSION_LIMIT }),
    ),
  ]);
  const last = rows[rows.length - 1];
  const thinking =
    turn?.promptAt !== undefined &&
    (turn.endedAt === undefined || turn.endedAt < turn.promptAt);
  return {
    ...(task === null ? {} : { task: task.statement }),
    actions: rows.length,
    ...(last === undefined
      ? {}
      : {
          lastDid: [last.operation, last.target]
            .filter((each) => each !== undefined)
            .join(' '),
          lastAt: last.at,
        }),
    turn: thinking
      ? 'in progress'
      : turn === null
        ? 'never asked'
        : 'handed back to them',
  };
}

/** Where the desktop app behind an `app_` session is installed, or null for any other session. */
function desktopAppOf(deps: SessionToolDeps, sessionId: string): string | null {
  const agent = sessionId.startsWith(APP_SESSION_PREFIX)
    ? sessionId.slice(APP_SESSION_PREFIX.length)
    : '';
  if (!isStartableAgent(agent)) return null;
  return (deps.resolveApp ?? resolveInstalledApp)(agent);
}

/** Where the session runs, and the checkout to open for it. */
async function whereItRuns(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<{ host: SessionHost | null; openAt?: string; early?: PlaceBeforeHook }> {
  const host = await new SessionHosts(deps.home).read(sessionId);
  // No hook noted it yet, as for an agent still asking its first question, so its run or its start says where.
  const early =
    host === null
      ? ((await placeBeforeHook(deps.home, sessionId)) ?? undefined)
      : undefined;
  // Where it runs was never noted, so its repository is opened in the editor instead.
  const place =
    host?.cwd ??
    early?.cwd ??
    (host === null
      ? ((await folderOf(deps, sessionId)) ?? (await justStartedIn(deps, sessionId)))
      : undefined);
  // The window the person already has open, never a worktree or subfolder that makes a new one.
  const found = early === undefined ? { host } : { host, early };
  return place === undefined ? found : { ...found, openAt: mainCheckoutOf(place) };
}

export interface ChangedFile {
  path: string;
  added: number | null;
  removed: number | null;
  kind?: string;
}

/** The files a session changed and a few changed lines of the one that changed most, for the card. */
async function codeFor(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
): Promise<{ files?: CardFile[]; excerpt?: CardExcerpt }> {
  const changes = (await changesTool(deps, seams, { session: sessionId })) as {
    files?: { shown: ChangedFile[] };
  };
  const shown = changes.files?.shown ?? [];
  if (shown.length === 0) return {};
  const files = shown.slice(0, CARD_FILES).map(cardFile);
  const excerpt = await excerptOf(deps, seams, sessionId, shown);
  return excerpt === null ? { files } : { files, excerpt };
}

/** The changed lines of the file a session changed most, leaving tests out, since that is the work. */
export async function excerptOf(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
  shown: readonly ChangedFile[],
): Promise<CardExcerpt | null> {
  const top = [...shown]
    .filter((each) => each.added !== null && each.kind !== 'test')
    .sort((a, b) => size(b) - size(a))[0];
  if (top === undefined) return null;
  const diff = (await changesTool(deps, seams, {
    session: sessionId,
    path: top.path,
  })) as {
    diff?: { lines: string[] };
  };
  const lines = changedLines(diff.diff?.lines ?? []);
  return lines.length === 0 ? null : { path: top.path, lines };
}

function cardFile(file: ChangedFile): CardFile {
  return {
    path: file.path,
    ...(file.added === null ? {} : { added: file.added }),
    ...(file.removed === null ? {} : { removed: file.removed }),
  };
}

function size(file: ChangedFile): number {
  return (file.added ?? 0) + (file.removed ?? 0);
}

/** The added and removed lines only, since headers and context say nothing at a glance. */
export function changedLines(diff: readonly string[]): string[] {
  return diff.filter(
    (line) =>
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---') &&
      line.slice(1).trim() !== '',
  );
}

const ALL_SHOWN =
  'Every session is on their screen now as a card of its own, all at once, each with Watch live and Open on it. Say so in one sentence, then how many are working, from the session list you were given. Never read the cards out one by one.';

const ON_SCREEN =
  'The card is on their screen in the top left corner, not in any app, with your summary laid out as written and the files it changed. The card already lists the files and the lines, so your summary says what the agent set out to do, why it changed what it changed, and where that stands, in plain words rather than file names or counts. Say in a whole sentence that the summary is on screen, then give the gist in two sentences of plain speech; never read the card out.';

/** Said with every display, since naming the wrong session confidently is worse than naming none. */
const NAME_IT =
  'Name the session by its task from showing, in a few words, so they can tell at once if it is the wrong one. What it is doing comes only from showing: never describe work showing does not list, and an actions count of zero means it has done nothing yet.';

const FOCUSED = `Their sessions turn past in 3D on screen and this one comes forward in its own terminal tab or editor conversation. Say you are taking them there, in a few words. ${NAME_IT}`;

const LIVE = `Their sessions turn past in 3D on screen and this one opens in a live window in the middle, showing what it is doing and its conversation as it happens. Say in a whole sentence that it is open. Never say it is in VS Code or any app. ${NAME_IT}`;

/** What the brain is told it showed, so it never says a card or a window is inside an app. */
function shownAs(display: DisplayKind, app: string | undefined): Record<string, unknown> {
  if (display === DISPLAY.CARD) return { shown: true, display, said: ON_SCREEN };
  if (display === DISPLAY.FOCUS) {
    return {
      shown: true,
      display,
      ...(app === undefined ? {} : { runsIn: app }),
      said: FOCUSED,
    };
  }
  return {
    shown: true,
    display,
    ...(app === undefined ? {} : { runsIn: app }),
    said: LIVE,
  };
}

/**
 * Where the session the voice just started was started, for an id that names the start or its
 * window rather than a session: it has no host and no ledger rows yet, and is still somewhere.
 */
async function justStartedIn(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<string | undefined> {
  if (!NOT_A_SESSION.some((prefix) => sessionId.startsWith(prefix))) return undefined;
  const focus = await new VoiceFocusStore(deps.home).read().catch(() => null);
  return focus?.why === FOCUS_STARTED ? focus.repository : undefined;
}

/** The first repository the session wrote in, from its own ledger rows. */
async function folderOf(
  deps: SessionToolDeps,
  sessionId: string,
): Promise<string | undefined> {
  const rows = await withEvents(deps.home, (store) =>
    store.query({ sessionId, limit: LEDGER_SESSION_LIMIT }),
  );
  return repositoriesOf(rows)[0];
}
