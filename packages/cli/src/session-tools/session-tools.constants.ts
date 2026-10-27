/**
 * Names the session tools share, so a pattern or an argument is spelled in one place and two files
 * never disagree about which apps find their own tabs or what a tool's yes looks like.
 */

/** Apps whose tab or terminal the Mac finds by its terminal device, never among panes or by what it shows. */
export const FINDS_ITS_TAB = /iterm|terminal|code|cursor|windsurf/i;

/** Apps that close a tab together with its agent and never stop to ask, so nothing is ended first. */
export const CLOSES_CLEANLY = /iterm|code|cursor|windsurf/i;

/** How a tool argument says yes and no, as every operator tool spells them. */
export const SAID = {
  YES: 'true',
  NO: 'false',
} as const;

/** The arguments the start, show, app and typing tools read, as their schemas name them. */
export const TOOL_ARG = {
  PANEL: 'panel',
  TERMINAL: 'terminal',
  NEW_CHAT: 'new_chat',
  ACTION: 'action',
  APP: 'app',
  AGENT: 'agent',
  NOW: 'now',
  HOLD_CREDENTIALS: 'hold_credentials',
} as const;

/** What control_app is asked to do. */
export const APP_ACTION = {
  STOP: 'stop',
  CLOSE: 'close',
} as const;

/** How a desktop app's own session is keyed, and how an app bundle's folder ends. */
export const APP_SESSION_PREFIX = 'app_';
export const APP_BUNDLE_SUFFIX = '.app';

/** An app's name as a session key: lowercase, with runs of anything else as one hyphen. */
export function appSessionId(name: string): string {
  return `${APP_SESSION_PREFIX}${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}
