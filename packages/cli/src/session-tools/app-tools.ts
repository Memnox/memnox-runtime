import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import {
  appLaunch,
  bundleOf,
  cursorPromptLink,
  DELIVERY,
  wentIn,
  DESKTOP_APPS,
  AGENT_ID,
  DISPLAY,
  DISPLAY_VIA,
  DisplayRequests,
  isStartableAgent,
  RunTerminals,
  SessionHosts,
  type DisplayDelivery,
  type SessionStart,
  type StartableAgent,
} from '@memnox/core';
import { unlessMacTold } from './mac-told';
import { processAlive } from './sessions-tool';
import { witnessed } from './witnessed';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import {
  APP_ACTION,
  APP_BUNDLE_SUFFIX,
  APP_SESSION_PREFIX,
  appSessionId,
  SAID,
  TOOL_ARG,
} from './session-tools.constants';

/**
 * The agents' own desktop apps, Claude, Codex, Cursor and Hermes: opened on a repository with a
 * new chat, or typed into where the person already is. Each runs outside `memnox run`, so it is
 * governed by the hooks and servers Memnox put in its config, as a chat opened there by hand is.
 */

/** A message is a few sentences said in one breath, never a page. */
const MOST_MESSAGE_CHARS = 600;

/** A new chat in the app on the repository, with the task typed in and sent. */
export async function openAppStart(
  deps: SessionToolDeps,
  start: SessionStart,
  moment: string,
): Promise<unknown> {
  const launch = appLaunch(start);
  const name = DESKTOP_APPS[start.agent].name;
  // Words the app's own prompt link carries into its chat, which the Mac sends once it reads them there.
  const prefilled = launch.typed === undefined && start.task.trim() !== '';
  const delivery = await shown(deps, {
    sessionId: start.id,
    agent: start.agent,
    name,
    ...(start.repository === undefined ? {} : { cwd: start.repository }),
    ...launch,
    // With no folder it is a question for a chat, asked in a new one rather than the chat left open.
    ...(start.repository === undefined && launch.typed !== undefined
      ? { newChat: true }
      : {}),
    ...(prefilled ? { sendPrefilled: true } : {}),
    at: moment,
  });
  const result: Record<string, unknown> = {
    ...openedIn(start, name),
    ...openedAs(delivery, launch.typed !== undefined),
  };
  // Called sent only when the Mac read the words in its chat and saw them go; otherwise they wait for the person's Return.
  if (prefilled && delivery?.outcome === DELIVERY.VERIFIED)
    return { ...result, said: APP_PREFILLED_SENT };
  if (prefilled && result['said'] === APP_OPENED)
    return { ...result, said: APP_PREFILLED };
  return start.repository === undefined && result['said'] === APP_OPENED
    ? { ...result, said: APP_OPENED_NO_FOLDER }
    : result;
}

/** Named as the app's own session, so a follow up to "the same session" is typed into this app. */
function openedIn(start: SessionStart, name: string): Record<string, unknown> {
  return {
    ...(start.repository === undefined
      ? { noFolder: true }
      : { repository: basename(start.repository) }),
    app: name,
    session: `${APP_SESSION_PREFIX}${start.agent}`,
  };
}

/**
 * Typed into the chat the person has open in the app, the way they would type it themselves,
 * for "type in Claude desktop and ask it to discuss Memnox". Their asking is their yes, as an
 * instruction to a session is, so nothing is read back first.
 */
export async function typeInAppTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const message = textArg(args, 'message');
  if (message === undefined) return { typed: false, said: NEEDS_MESSAGE };
  const named = textArg(args, TOOL_ARG.APP);
  const agent =
    textArg(args, TOOL_ARG.AGENT) ?? (named === undefined ? AGENT_ID.CLAUDE_CODE : named);
  const newChat = textArg(args, TOOL_ARG.NEW_CHAT) === SAID.YES;
  if (!isStartableAgent(agent))
    return typeInNamedApp(deps, named ?? agent, message, newChat);
  const resolve = deps.resolveApp ?? resolveInstalledApp;
  const appPath = resolve(agent);
  if (appPath === null) return { typed: false, ...noApp(agent, resolve) };
  const moment = deps.now().toISOString();
  const words = message.split(/\r?\n/).join(' ').trim().slice(0, MOST_MESSAGE_CHARS);
  if (agent === AGENT_ID.CURSOR) return promptedInCursor(deps, appPath, words, moment);
  const delivery = await shown(deps, {
    sessionId: `${APP_SESSION_PREFIX}${agent}`,
    agent,
    name: DESKTOP_APPS[agent].name,
    appPath,
    links: [],
    typed: words,
    ...(newChat ? { newChat } : {}),
    at: moment,
  });
  const result = openedAs(delivery, true);
  return { app: DESKTOP_APPS[agent].name, typed: result['started'], ...result };
}

/**
 * Cursor's agent chat filled by Cursor's own prompt link, and sent by the Mac once it reads the words there. Typed
 * instead, the words went wherever Cursor's focus was, its welcome page or a file, and an empty box read as sent.
 */
async function promptedInCursor(
  deps: SessionToolDeps,
  appPath: string,
  words: string,
  moment: string,
): Promise<unknown> {
  const name = DESKTOP_APPS[AGENT_ID.CURSOR].name;
  const delivery = await shown(deps, {
    sessionId: `${APP_SESSION_PREFIX}${AGENT_ID.CURSOR}`,
    agent: AGENT_ID.CURSOR,
    name,
    appPath,
    links: [cursorPromptLink(words)],
    sendPrefilled: true,
    at: moment,
  });
  const result = openedAs(delivery, false);
  // Sent only when the Mac read the words in Cursor's chat and saw them go; otherwise they wait there for Return.
  if (delivery?.outcome === DELIVERY.VERIFIED)
    return { app: name, typed: true, ...result, said: APP_PREFILLED_SENT };
  if (result['said'] === APP_OPENED)
    return { app: name, typed: false, ...result, said: CURSOR_PREFILLED };
  return { app: name, typed: false, ...result };
}

interface AppShow {
  sessionId: string;
  agent: string;
  name: string;
  cwd?: string;
  appPath?: string;
  env?: Record<string, string>;
  links: string[];
  typed?: string;
  /** A new chat first, rather than typing into the one open. */
  newChat?: boolean;
  /** The words a prompt link left in its chat sent, once the Mac reads them there. */
  sendPrefilled?: boolean;
  at: string;
}

/** Handed to the Mac to open and type, and what it said became of it, or null when it never said. */
async function shown(
  deps: SessionToolDeps,
  show: AppShow,
): Promise<DisplayDelivery | null> {
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.APP,
    sessionId: show.sessionId,
    agent: show.agent,
    title: show.name,
    ...(show.typed === undefined ? {} : { text: show.typed }),
    ...(show.cwd === undefined ? {} : { cwd: show.cwd }),
    ...(show.appPath === undefined ? {} : { appPath: show.appPath }),
    links: show.links,
    ...(show.env === undefined ? {} : { env: show.env }),
    ...(show.newChat === true
      ? { via: DISPLAY_VIA.NEW_CHAT }
      : show.sendPrefilled === true
        ? { via: DISPLAY_VIA.SEND_PREFILLED }
        : {}),
    at: show.at,
  });
  return deps.delivered === undefined ? null : deps.delivered(request.id);
}

/**
 * An agent's desktop app, or any app the person names, stopped or closed the way they would:
 * its Stop button or Escape for a reply in progress, and its window closed, the chat kept in the app.
 */
export async function controlAppTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const action = textArg(args, TOOL_ARG.ACTION);
  if (action !== APP_ACTION.STOP && action !== APP_ACTION.CLOSE)
    return { done: false, said: NEEDS_ACTION };
  const named =
    textArg(args, TOOL_ARG.APP) ?? textArg(args, TOOL_ARG.AGENT) ?? AGENT_ID.CLAUDE_CODE;
  const appPath = isStartableAgent(named)
    ? (deps.resolveApp ?? resolveInstalledApp)(named)
    : (deps.findApp ?? installedAppNamed)(named);
  if (appPath === null) return { done: false, said: noSuchApp(named) };
  const name = basename(appPath, APP_BUNDLE_SUFFIX);
  const request = await new DisplayRequests(deps.home).request({
    display: action === APP_ACTION.STOP ? DISPLAY.INTERRUPT : DISPLAY.CLOSE,
    sessionId: appSessionId(name),
    agent: name,
    title: name,
    appPath,
    at: deps.now().toISOString(),
  });
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  if (delivery === null) return { app: name, done: false, said: CONTROL_UNCONFIRMED };
  if (wentIn(delivery.outcome))
    return {
      app: name,
      done: true,
      said: action === APP_ACTION.STOP ? APP_STOPPED : APP_CLOSED,
    };
  return {
    app: name,
    done: false,
    ...(delivery.reason === undefined ? {} : { why: delivery.reason }),
    said: unlessMacTold(delivery, APP_NOT_CONTROLLED),
  };
}

const NEEDS_ACTION =
  'Pass action: "stop" for a reply in progress, or "close" for its window.';
const CONTROL_UNCONFIRMED =
  'Handed to the Mac, which has not said it worked yet. Say you asked it to; never that it is done.';
const APP_STOPPED =
  'Its reply in progress was stopped, and the chat is as it was. Say it is stopped in a few words.';
const APP_CLOSED =
  'Its window is closed; the app keeps the chat, so it can be opened again. Say it is closed in a few words.';
const APP_NOT_CONTROLLED =
  'The Mac could not do it: why says the reason. Say sorry in a few words and the reason in plain words.';

/** What the brain may say, from what the Mac reported, with what the screen showed after. */
function openedAs(
  delivery: DisplayDelivery | null,
  hadWords: boolean,
): Record<string, unknown> {
  return { ...outcomeOf(delivery, hadWords), ...witnessed(delivery) };
}

/** What the brain may say, from what the Mac reported, so words never typed are never called sent. */
function outcomeOf(
  delivery: DisplayDelivery | null,
  hadWords: boolean,
): Record<string, unknown> {
  if (delivery === null) return { started: true, said: UNCONFIRMED };
  if (wentIn(delivery.outcome))
    return { started: true, said: hadWords ? APP_TYPED : APP_OPENED };
  if (delivery.outcome === DELIVERY.CLIPBOARD && delivery.reason !== undefined)
    return { started: true, why: delivery.reason, said: APP_CLIPBOARD_WHY };
  if (
    delivery.outcome === DELIVERY.CLIPBOARD ||
    delivery.outcome === DELIVERY.NOT_ALLOWED
  )
    return { started: true, said: APP_CLIPBOARD };
  return {
    started: false,
    ...(delivery.reason === undefined ? {} : { why: delivery.reason }),
    said: unlessMacTold(delivery, NOT_OPENED),
  };
}

/**
 * Any other app the person named, found among what is installed, typed into the same way: the Mac
 * brings it forward and types into its message box, and says so when it finds none.
 */
async function typeInNamedApp(
  deps: SessionToolDeps,
  name: string,
  message: string,
  newChat: boolean,
): Promise<unknown> {
  const appPath = (deps.findApp ?? installedAppNamed)(name);
  if (appPath === null) return { typed: false, said: noSuchApp(name) };
  const shownName = basename(appPath, APP_BUNDLE_SUFFIX);
  const hosted = await sessionHostedIn(deps.home, appPath, shownName);
  const delivery = await shown(deps, {
    sessionId: hosted?.sessionId ?? appSessionId(shownName),
    agent: hosted?.agent ?? shownName,
    name: shownName,
    appPath,
    links: [],
    typed: message.split(/\r?\n/).join(' ').trim().slice(0, MOST_MESSAGE_CHARS),
    ...(newChat ? { newChat } : {}),
    at: deps.now().toISOString(),
  });
  const result = openedAs(delivery, true);
  return { app: shownName, typed: result['started'], ...result };
}

/** Terminal apps by their spoken names, where typing reaches the agent session running in the front tab. */
const TERMINAL_APPS: ReadonlySet<string> = new Set([
  'terminal',
  'iterm',
  'iterm2',
  'ghostty',
  'wezterm',
  'warp',
  'kitty',
  'alacritty',
  'hyper',
  'tabby',
]);

/**
 * The live agent session running in a terminal app, the newest where there are several, so words
 * typed there are kept in that session rather than one invented for the app, which no agent is.
 */
async function sessionHostedIn(
  home: string,
  appPath: string,
  name: string,
): Promise<{ sessionId: string; agent: string } | null> {
  if (!TERMINAL_APPS.has(spoken(name))) return null;
  const inApp = (place: { app?: string; appPath?: string }): boolean =>
    place.appPath === appPath || place.app === name;
  const [hosts, runs] = await Promise.all([
    new SessionHosts(home).all(),
    new RunTerminals(home).all(),
  ]);
  const live = [
    ...hosts
      .filter((each) => each.endedAt === undefined && each.panel !== true)
      .map((each) => ({ ...each, at: each.seenAt })),
    ...runs.map((each) => ({ ...each, at: each.startedAt })),
  ]
    .filter((each) => inApp(each) && processAlive(each.pid))
    .sort((a, b) => b.at.localeCompare(a.at));
  const newest = live[0];
  return newest === undefined
    ? null
    : { sessionId: newest.sessionId, agent: newest.agent };
}

/** Where apps are installed, the person's own folder after the shared one. */
const APP_FOLDERS = [
  '/Applications',
  join(homedir(), 'Applications'),
  '/Applications/Utilities',
];

/** An installed app by the name somebody says, spaces and case aside, the exact name first. */
export function installedAppNamed(
  name: string,
  folders: readonly string[] = APP_FOLDERS,
): string | null {
  const wanted = spoken(name);
  if (wanted === '') return null;
  const apps = folders.flatMap((folder) => {
    try {
      return readdirSync(folder)
        .filter((entry) => entry.endsWith(APP_BUNDLE_SUFFIX))
        .map((entry) => join(folder, entry));
    } catch {
      return [];
    }
  });
  const named = (path: string): string => spoken(basename(path, APP_BUNDLE_SUFFIX));
  // People add the version an app had, as iTerm2 for iTerm.app, so a name with it taken off counts too.
  const unversioned = wanted.replace(TRAILING_VERSION, '');
  return (
    apps.find((path) => named(path) === wanted) ??
    apps.find((path) => named(path) === unversioned) ??
    apps.find((path) => named(path).startsWith(wanted)) ??
    null
  );
}

const TRAILING_VERSION = /\d+$/;

function spoken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function noSuchApp(name: string): string {
  return `No app called ${name} is installed on this Mac, so nothing was typed. Say so in a sentence and ask which app they meant.`;
}

/** What to say when the agent has no desktop app on this Mac, with the agents that do. */
export function noApp(
  agent: StartableAgent,
  resolve: (agent: StartableAgent) => string | null,
): { missing: string; installed: string[]; said: string } {
  const installed = (Object.keys(DESKTOP_APPS) as StartableAgent[]).filter(
    (each) => resolve(each) !== null,
  );
  return {
    missing: `the ${DESKTOP_APPS[agent].name} app`,
    installed,
    said: `The ${DESKTOP_APPS[agent].name} desktop app is not installed on this Mac. Say so plainly, and offer its terminal agent instead, or another app from installed.`,
  };
}

/** The agent's desktop app bundle, the first place it is found installed. */
export function resolveInstalledApp(agent: StartableAgent): string | null {
  const found = DESKTOP_APPS[agent].places
    .map((place) => (place.startsWith('~/') ? join(homedir(), place.slice(2)) : place))
    .find((place) => existsSync(place));
  return found === undefined ? null : bundleOf(found);
}

const NEEDS_MESSAGE = 'Pass message: what to type, in their words.';
const APP_TYPED =
  'The app is open and the Mac typed their words into its message box and sent them, so it is answering now. Say so in a few words, like "Sent to Claude." Never say it is done.';
const APP_OPENED =
  'The app opened on that repository. Say so in a few words, like "Hermes is open in memnox runtime.", and ask what they would like it to do.';
const APP_OPENED_NO_FOLDER =
  'The app is open, on no folder since they named none. Say so in a few words, like "Claude is open.", and ask what they would like it to do; never name a repository.';
const APP_PREFILLED =
  'The app opened on that repository with their words already in its chat, where it waits for them to press Return, since the app asks before running a prompt it was handed. Say that in one sentence, like "Cursor is open with your question in its chat; press Return there to send it." Never ask what it should do, and never offer to send it again.';
const CURSOR_PREFILLED =
  'Cursor has their words in its agent chat, but the Mac could not see them go, so they may be waiting there for Return. Say that in one sentence, like "It is in Cursor\'s chat; press Return there if it has not started." Never say it was sent, and never offer to type it again.';
const APP_PREFILLED_SENT =
  'The app opened, its own link put their words in its chat, and the Mac read them there and sent them, so it is answering now. Say so in a few words, like "Sent to Cursor." Never say it is done, and never ask them to press Return.';
const APP_CLIPBOARD =
  'The app is open, but the Mac could not type into it, and it already told them out loud the words are on the clipboard and how to paste them. Write nothing more.';
// The Mac was allowed to type and found nowhere to, so a later "what do you need" is never answered with a permission.
const APP_CLIPBOARD_WHY =
  'The app is open, but the Mac found nowhere in it to type, and it already told them out loud the words are on the clipboard and how to paste them. Write nothing more now. Memnox is allowed to type, so if they ask why or what it needs, give the reason in why in plain words and never say it needs a permission or anything switched on.';
const UNCONFIRMED =
  'Handed to the Mac to open, which has not confirmed yet. Say it is opening; never that it is working.';
const NOT_OPENED =
  'The Mac could not open the app. Say sorry in a few words and say why in plain words; nothing was sent.';
