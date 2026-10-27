import { hostOf, RunTerminals, type SessionHost } from '@memnox/core';
import { processChain } from '@memnox/interceptors';
import type { PreparedRun } from './prepare';

/** Where a run is on screen: its terminal device and the app that tab is in. */
type RunPlace = Pick<SessionHost, 'app' | 'appPath' | 'tty'>;

/** This process's own tab, read upward from it, or nothing where `ps` cannot be run. */
export function ownTerminal(): RunPlace {
  try {
    return hostOf(processChain(process.pid));
  } catch {
    // A sandbox without ps: the run still starts, it only cannot be answered by voice before its hook.
    return {};
  }
}

/** Noted before the agent starts, because what it asks before its first hook is asked in this tab. */
export async function noteRunTerminal(
  run: PreparedRun,
  cwd: string,
  place: RunPlace,
  at: string,
): Promise<void> {
  await new RunTerminals(run.home)
    .note({
      sessionId: run.sessionId,
      agent: run.agent,
      pid: process.pid,
      ...place,
      cwd,
      startedAt: at,
    })
    .catch(() => undefined);
}

/** Gone with the run, so a closed tab is never pressed into. */
export async function forgetRunTerminal(run: PreparedRun): Promise<void> {
  await new RunTerminals(run.home).forget(run.sessionId).catch(() => undefined);
}
