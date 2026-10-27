import { RunTerminals, type RunTerminal, type ShownIn } from '@memnox/core';
import { processAlive } from './live-host';

/**
 * The tab a `memnox run` noted for itself while it still runs: where its agent asks its questions,
 * and the place to read or press in even after a hook noted the agent on a terminal of its own.
 */

/** The run, only while it is still running, so a closed tab is never read or pressed into. */
export async function liveRun(
  home: string,
  sessionId: string,
): Promise<RunTerminal | null> {
  const run = await new RunTerminals(home).read(sessionId).catch(() => null);
  return run !== null && processAlive(run.pid) ? run : null;
}

/** Where the run's tab is, or null when it never read its own terminal. */
export function tabOf(run: RunTerminal | null): ShownIn | null {
  if (run === null || run.tty === undefined) return null;
  return {
    ...(run.app === undefined ? {} : { app: run.app }),
    ...(run.appPath === undefined ? {} : { appPath: run.appPath }),
    tty: run.tty,
  };
}
