import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import {
  EDITOR_APP,
  EDITOR_APPS,
  editorNamed,
  type EditorApp,
  type SessionStart,
  type StartableAgent,
} from '@memnox/core';
import { installedAppNamed, resolveInstalledApp } from './app-tools';
import {
  multiplexerNamed,
  runningMultiplexer,
  type MultiplexerName,
} from './multiplexer';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { lastSurface, START_SURFACE, type KeptSurface } from './start-surface';
import { APP_BUNDLE_SUFFIX, SAID, TOOL_ARG } from './session-tools.constants';

/**
 * Where a new session runs, which is part of what the person asked for: a terminal tab, the
 * agent's desktop app, or a new terminal inside the editor they named.
 */

export const PLACE = {
  APP: 'app',
  TERMINAL: 'terminal',
  EDITOR: 'editor',
  /** They named an editor that is not installed, which is said rather than started elsewhere. */
  NO_EDITOR: 'no-editor',
  /** They named something as the editor that is no editor Memnox knows, which is asked about rather than guessed. */
  UNKNOWN_EDITOR: 'unknown-editor',
  /** A new window of the tmux or WezTerm running here. */
  PANE: 'pane',
  /** A new window of another terminal app they named, such as Ghostty or Warp. */
  TERMINAL_APP: 'terminal-app',
  /** They named a terminal that is not installed, or a tmux that is not running. */
  NO_TERMINAL: 'no-terminal',
} as const;

/** Where a new session runs: a terminal tab, the agent's desktop app, or a terminal inside an editor. */
type Place =
  | {
      kind:
        | typeof PLACE.APP
        | typeof PLACE.TERMINAL
        | typeof PLACE.NO_EDITOR
        | typeof PLACE.UNKNOWN_EDITOR
        | typeof PLACE.NO_TERMINAL;
    }
  | { kind: typeof PLACE.EDITOR; editor: EditorApp; path: string }
  | { kind: typeof PLACE.PANE; multiplexer: MultiplexerName }
  | { kind: typeof PLACE.TERMINAL_APP; path: string };

/** The terminals the voice already opens a tab in, by the names people call them. */
const OWN_TERMINALS = /^(iterm2?|terminal|the terminal|a terminal|terminal app)$/i;

/**
 * The editor they named, then the desktop app when they said so, then where they last had this
 * agent while it is still installed, and a terminal tab otherwise. A place they name always wins
 * over one remembered, since "in VS Code" said aloud is never a guess.
 */
export async function placeFor(
  deps: SessionToolDeps,
  args: ToolArgs,
  agent: StartableAgent,
): Promise<Place> {
  const editorSaid = textArg(args, 'editor');
  // The Claude Code panel lives in an editor, the first one installed when they named none.
  if (
    textArg(args, TOOL_ARG.PANEL) === SAID.YES &&
    (editorSaid === undefined || editorSaid === SAID.NO)
  )
    return inEditor(deps, null) ?? { kind: PLACE.NO_EDITOR };
  if (editorSaid !== undefined && editorSaid !== SAID.NO) {
    const editor = editorSaid === SAID.YES ? null : editorNamed(editorSaid);
    // A name that is no editor, such as a misheard Cursor, never falls to whichever editor is installed first.
    if (editor === null && editorSaid !== SAID.YES) return { kind: PLACE.UNKNOWN_EDITOR };
    return inEditor(deps, editor) ?? { kind: PLACE.NO_EDITOR };
  }
  const terminalSaid = textArg(args, TOOL_ARG.TERMINAL);
  if (terminalSaid !== undefined)
    return terminalNamed(deps, terminalSaid) ?? { kind: PLACE.NO_TERMINAL };
  const said = textArg(args, TOOL_ARG.APP);
  if (said !== undefined) return { kind: said === SAID.YES ? PLACE.APP : PLACE.TERMINAL };
  const last = await lastSurface(deps.home, agent);
  if (
    last?.surface === START_SURFACE.PANE ||
    last?.surface === START_SURFACE.TERMINAL_APP
  ) {
    const again = terminalNamed(deps, last.pane ?? last.terminal ?? '');
    if (again !== null) return again;
  }
  if (last?.surface === START_SURFACE.EDITOR) {
    return inEditor(deps, last.editor ?? null) ?? { kind: PLACE.TERMINAL };
  }
  const appThere =
    last?.surface === START_SURFACE.APP &&
    (deps.resolveApp ?? resolveInstalledApp)(agent) !== null;
  return { kind: appThere ? PLACE.APP : PLACE.TERMINAL };
}

/** The terminal they named: a running tmux or WezTerm, iTerm or Terminal, or another terminal app installed here. */
function terminalNamed(deps: SessionToolDeps, said: string): Place | null {
  if (OWN_TERMINALS.test(said.trim())) return { kind: PLACE.TERMINAL };
  const multiplexer = multiplexerNamed(said);
  if (multiplexer !== null)
    return runningMultiplexer(multiplexer, deps.panes) === null
      ? null
      : { kind: PLACE.PANE, multiplexer };
  const path = said.startsWith('/') ? said : (deps.findApp ?? installedAppNamed)(said);
  return path === null || !existsSync(path) ? null : { kind: PLACE.TERMINAL_APP, path };
}

/** The editor named, or with none named the first installed, or null when it is not on this Mac. */
function inEditor(deps: SessionToolDeps, named: EditorApp | null): Place | null {
  const resolve = deps.resolveEditor ?? resolveInstalledEditor;
  const editors = named === null ? Object.values(EDITOR_APP) : [named];
  for (const editor of editors) {
    const path = resolve(editor);
    if (path !== null) return { kind: PLACE.EDITOR, editor, path };
  }
  return null;
}

/** The editor's app bundle, the first place it is found installed. */
function resolveInstalledEditor(editor: EditorApp): string | null {
  return (
    EDITOR_APPS[editor].places
      .map((place) => (place.startsWith('~/') ? join(homedir(), place.slice(2)) : place))
      .find((place) => existsSync(place)) ?? null
  );
}

/** Where to start this agent next time, which is where it started now. */
export function surfaceOf(deps: SessionToolDeps, start: SessionStart): KeptSurface {
  if (start.app !== undefined) return { surface: START_SURFACE.APP };
  if (start.pane !== undefined) return { surface: START_SURFACE.PANE, pane: start.pane };
  if (start.terminal !== undefined)
    return { surface: START_SURFACE.TERMINAL_APP, terminal: start.terminal };
  const editor = editorOf(deps, start);
  return editor === null
    ? { surface: START_SURFACE.TERMINAL }
    : { surface: START_SURFACE.EDITOR, editor };
}

/** Which editor the start's bundle is, or null for a start in a terminal tab. */
function editorOf(deps: SessionToolDeps, start: SessionStart): EditorApp | null {
  if (start.editor === undefined) return null;
  const resolve = deps.resolveEditor ?? resolveInstalledEditor;
  return Object.values(EDITOR_APP).find((each) => resolve(each) === start.editor) ?? null;
}

/** The editor as people name it, from the bundle the start was proposed with. */
export function editorName(deps: SessionToolDeps, start: SessionStart): string {
  const editor = editorOf(deps, start);
  return editor === null
    ? basename(start.editor ?? '', APP_BUNDLE_SUFFIX)
    : EDITOR_APPS[editor].name;
}
