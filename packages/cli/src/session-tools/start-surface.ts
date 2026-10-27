import { join } from 'node:path';
import {
  EDITOR_APPS,
  MEMNOX_HOME,
  readJsonFile,
  writeJsonFile,
  type EditorApp,
} from '@memnox/core';

/**
 * Where the person last had each agent started, its desktop app, a terminal or inside an editor,
 * so "start Hermes on the tests" goes where they had it before and a correction is said once.
 */

const SURFACE_FILE = join('voice', 'start-surfaces.json');

export const START_SURFACE = {
  APP: 'app',
  TERMINAL: 'terminal',
  EDITOR: 'editor',
  /** A new window of the tmux or WezTerm running here. */
  PANE: 'pane',
  /** A new window of another terminal app, such as Ghostty. */
  TERMINAL_APP: 'terminal-app',
} as const;

type StartSurface = (typeof START_SURFACE)[keyof typeof START_SURFACE];

/** Where an agent was last started, with the editor when it was inside one. */
export interface KeptSurface {
  surface: StartSurface;
  editor?: EditorApp;
  /** tmux or WezTerm, for a pane. */
  pane?: string;
  /** The terminal app's bundle, for a terminal app. */
  terminal?: string;
}

/** Between a surface and where on it, as `editor:vscode` or `pane:tmux` keep it. */
const SURFACE_SEPARATOR = ':';
/** An editor is kept as `editor:vscode`, so a file written before editors still reads. */
const EDITOR_PREFIX = `${START_SURFACE.EDITOR}${SURFACE_SEPARATOR}`;

export async function lastSurface(
  home: string,
  agent: string,
): Promise<KeptSurface | null> {
  const kept = await readJsonFile<Record<string, string>>(
    join(home, MEMNOX_HOME, SURFACE_FILE),
  );
  const surface = kept?.[agent];
  if (surface === START_SURFACE.APP || surface === START_SURFACE.TERMINAL)
    return { surface };
  for (const kind of [START_SURFACE.PANE, START_SURFACE.TERMINAL_APP] as const) {
    const where =
      surface?.startsWith(`${kind}${SURFACE_SEPARATOR}`) === true
        ? surface.slice(kind.length + SURFACE_SEPARATOR.length)
        : '';
    if (where === '') continue;
    return kind === START_SURFACE.PANE
      ? { surface: kind, pane: where }
      : { surface: kind, terminal: where };
  }
  const editor = surface?.startsWith(EDITOR_PREFIX)
    ? surface.slice(EDITOR_PREFIX.length)
    : undefined;
  return editor !== undefined && isEditor(editor)
    ? { surface: START_SURFACE.EDITOR, editor }
    : null;
}

function isEditor(name: string): name is EditorApp {
  return Object.keys(EDITOR_APPS).includes(name);
}

export async function keepSurface(
  home: string,
  agent: string,
  kept: KeptSurface,
): Promise<void> {
  const path = join(home, MEMNOX_HOME, SURFACE_FILE);
  const all = (await readJsonFile<Record<string, string>>(path)) ?? {};
  const where = kept.editor ?? kept.pane ?? kept.terminal;
  const value =
    where === undefined ? kept.surface : `${kept.surface}${SURFACE_SEPARATOR}${where}`;
  await writeJsonFile(path, { ...all, [agent]: value });
}
