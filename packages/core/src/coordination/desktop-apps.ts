import { basename } from 'node:path';
import type { SessionStart, StartableAgent } from './session-starts';

/**
 * An agent's own desktop app, for "open Codex desktop and ask it to review my changes": the app is
 * opened on the repository with the task in its composer, through the links each app answers to.
 */

export interface DesktopApp {
  /** As a person names it, and as the Mac flies toward it. */
  name: string;
  /**
   * Where it is installed, `~` for the home folder, first found wins. A path inside a bundle
   * proves that bundle is this app, since ChatGPT.app is Codex only when it carries codex-cli.
   */
  places: readonly string[];
}

export const DESKTOP_APPS: Readonly<Record<StartableAgent, DesktopApp>> = {
  'claude-code': {
    name: 'Claude',
    places: ['/Applications/Claude.app', '~/Applications/Claude.app'],
  },
  codex: {
    name: 'Codex',
    places: [
      '/Applications/Codex.app',
      '~/Applications/Codex.app',
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli',
      '~/Applications/ChatGPT.app/Contents/Resources/codex-cli',
    ],
  },
  cursor: {
    name: 'Cursor',
    places: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
  },
  hermes: {
    name: 'Hermes',
    places: [
      '/Applications/Hermes.app',
      '~/Applications/Hermes.app',
      // Built from source by `hermes desktop`, which never copies it into Applications.
      '~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app',
      '~/.hermes/hermes-agent/apps/desktop/release/mac/Hermes.app',
    ],
  },
};

/** Editors a session can start in, in a new terminal the Memnox extension opens there. */
export const EDITOR_APP = {
  VSCODE: 'vscode',
  CURSOR: 'cursor',
  WINDSURF: 'windsurf',
} as const;

export type EditorApp = (typeof EDITOR_APP)[keyof typeof EDITOR_APP];

/** VS Code first, since that is where Claude Code most often runs inside an editor. */
export const EDITOR_APPS: Readonly<Record<EditorApp, DesktopApp>> = {
  vscode: {
    name: 'VS Code',
    places: [
      '/Applications/Visual Studio Code.app',
      '~/Applications/Visual Studio Code.app',
    ],
  },
  cursor: {
    name: 'Cursor',
    places: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
  },
  windsurf: {
    name: 'Windsurf',
    places: ['/Applications/Windsurf.app', '~/Applications/Windsurf.app'],
  },
};

/** The editor a person means, however a recognizer spelled it, or null when it names none. */
export function editorNamed(said: string): EditorApp | null {
  const words = said.toLowerCase().replace(/[^a-z]/g, '');
  if (/vscode|visualstudio|^code$/.test(words)) return EDITOR_APP.VSCODE;
  if (words.includes('cursor')) return EDITOR_APP.CURSOR;
  if (words.includes('windsurf')) return EDITOR_APP.WINDSURF;
  return null;
}

/** The bundle a found place belongs to: the place itself, or the outermost `.app` holding it. */
export function bundleOf(place: string): string {
  const at = place.indexOf('.app/');
  return at === -1 ? place : place.slice(0, at + '.app'.length);
}

/** How the Mac opens an app on a repository, in the order it does each part. */
export interface AppLaunch {
  /** Opened first and brought forward, so a link that follows reaches a window that is there. */
  appPath?: string;
  /** Set for the app as it opens, for an app that reads its folder from nowhere else. */
  env?: Record<string, string>;
  /** Opened in order, a moment apart, each answered by the app's own link handler. */
  links: string[];
  /** Typed into the app's message box once it is open and sent, so the person watches it go in. */
  typed?: string;
}

/**
 * A new chat on the repository through each app's own deep link, with the task typed in after so
 * it is sent where the person sees it. Cursor's prompt link fills its chat instead, since once a
 * folder opens there its focus is in the code and typing would land in a file.
 */
export function appLaunch(start: SessionStart): AppLaunch {
  const folder = start.repository;
  const task = start.task.split(/\r?\n/).join(' ').trim();
  const opened = {
    ...(start.app === undefined ? {} : { appPath: start.app }),
    ...(task === '' ? {} : { typed: task }),
  };
  if (folder === undefined) return chatLaunch(start, opened, task);
  switch (start.agent) {
    case 'codex':
      return { ...opened, links: [`codex://threads/new?${query({ path: folder })}`] };
    case 'claude-code':
      return { ...opened, links: [`claude://code/new?${query({ folder })}`] };
    case 'cursor':
      return {
        ...(start.app === undefined ? {} : { appPath: start.app }),
        links: [
          `cursor://file${encodeURI(folder)}/`,
          ...(task === '' ? [] : [cursorPromptLink(task, folder)]),
        ],
      };
    case 'hermes':
      // Hermes opens on the folder it is launched with and has no link of its own for a chat.
      return { ...opened, env: { HERMES_DESKTOP_CWD: folder }, links: [] };
  }
}

/**
 * A chat with no folder, for a question that is about no project: the app comes forward and the
 * task is typed into a new chat there, except Cursor, whose chat its prompt link fills.
 */
function chatLaunch(
  start: SessionStart,
  opened: Pick<AppLaunch, 'appPath' | 'typed'>,
  task: string,
): AppLaunch {
  if (start.agent !== 'cursor') return { ...opened, links: [] };
  return {
    ...(start.app === undefined ? {} : { appPath: start.app }),
    links: task === '' ? [] : [cursorPromptLink(task)],
  };
}

/**
 * Cursor's own link to its agent chat with the words already in it, on the folder's window where one is named. Typing
 * into Cursor instead lands wherever its focus is, which once a folder is open is the code or its welcome page.
 */
export function cursorPromptLink(text: string, folder?: string): string {
  const values: Record<string, string> = { text };
  if (folder !== undefined) values['workspace'] = basename(folder);
  return `cursor://anysphere.cursor-deeplink/prompt?${query(values)}`;
}

/** Every value percent encoded, spaces as %20, since an app's handler decodes it and never `+`. */
function query(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}
