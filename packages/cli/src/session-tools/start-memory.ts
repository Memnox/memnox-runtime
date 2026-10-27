import { join } from 'node:path';
import {
  MEMNOX_HOME,
  readJsonArray,
  readJsonFile,
  RunTerminals,
  writeJsonFile,
  type RunTerminal,
} from '@memnox/core';
import { liveRun } from './run-tab';

/**
 * What the voice proposed and started a moment ago: the folder of the last proposal, so a
 * correction that names only another agent keeps the folder they named, and where each start
 * runs, so a show by the id it was started under still finds its tab, its app or its folder.
 */

const PROPOSED_FILE = join('voice', 'last-proposed-folder.json');
const STARTED_FILE = join('voice', 'started-places.json');

/** Long enough to hear a read back and correct it, short enough that a new request is never taken for one. */
export const CORRECTION_MS = 2 * 60 * 1_000;

/** Enough starts to show any from the last hour, few enough that the file stays small. */
const MOST_STARTS_KEPT = 20;

interface ProposedFolder {
  repository: string;
  /** How it was chosen when it was a guess, so a guess carried over is still read back. */
  from?: string;
  at: string;
}

export async function keepProposedFolder(
  home: string,
  folder: ProposedFolder,
): Promise<void> {
  await writeJsonFile(join(home, MEMNOX_HOME, PROPOSED_FILE), folder).catch(
    () => undefined,
  );
}

/** The folder proposed since that moment, or null when none was. */
export async function proposedFolderSince(
  home: string,
  since: string,
): Promise<ProposedFolder | null> {
  const kept = await readJsonFile<ProposedFolder>(join(home, MEMNOX_HOME, PROPOSED_FILE));
  return kept !== null && kept.at >= since ? kept : null;
}

/** Where a start went, under every id the voice may later name it by. */
interface StartedPlace {
  /** The start's own id and the id of the request that opened it. */
  ids: string[];
  agent: string;
  repository?: string;
  /** The desktop app, editor or terminal app it opened in, when it was not a terminal tab. */
  appPath?: string;
  at: string;
}

export async function noteStarted(home: string, place: StartedPlace): Promise<void> {
  const path = join(home, MEMNOX_HOME, STARTED_FILE);
  const kept = await readJsonArray<StartedPlace>(path);
  await writeJsonFile(path, [place, ...kept].slice(0, MOST_STARTS_KEPT)).catch(
    () => undefined,
  );
}

async function startedPlace(home: string, id: string): Promise<StartedPlace | null> {
  const kept = await readJsonArray<StartedPlace>(join(home, MEMNOX_HOME, STARTED_FILE));
  return kept.find((each) => each.ids.includes(id)) ?? null;
}

/** Where a session runs before its agent first acts: the tab its run noted, or where the voice started it. */
export interface PlaceBeforeHook {
  cwd?: string;
  appPath?: string;
  tty?: string;
  /** The run's id, printed in its tab, which finds the tab when its device does not. */
  marks?: string[];
}

/**
 * For an id no hook has noted yet: the run by that id while it runs, or the start by its own id or
 * its request's, with the run that came up where it was started, so show and look reach it.
 */
export async function placeBeforeHook(
  home: string,
  sessionId: string,
): Promise<PlaceBeforeHook | null> {
  const run = (await liveRun(home, sessionId)) ?? (await runOfStart(home, sessionId));
  if (run !== null) return ofRun(run);
  const placed = await startedPlace(home, sessionId);
  if (placed === null) return null;
  return {
    ...(placed.repository === undefined ? {} : { cwd: placed.repository }),
    ...(placed.appPath === undefined ? {} : { appPath: placed.appPath }),
  };
}

/** The run that came up where a start by this id was started, while it still runs. */
export async function runOfStart(home: string, id: string): Promise<RunTerminal | null> {
  const placed = await startedPlace(home, id);
  if (placed?.repository === undefined) return null;
  const began = await new RunTerminals(home).startedIn(placed.repository, placed.at);
  return began === null ? null : liveRun(home, began.sessionId);
}

function ofRun(run: RunTerminal): PlaceBeforeHook {
  return {
    cwd: run.cwd,
    ...(run.appPath === undefined ? {} : { appPath: run.appPath }),
    ...(run.tty === undefined ? {} : { tty: run.tty }),
    marks: [run.sessionId],
  };
}
