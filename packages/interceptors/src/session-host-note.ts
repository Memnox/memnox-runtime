import { execFileSync } from 'node:child_process';

import {
  agentProcessOf,
  hostOf,
  RunTerminals,
  SessionHosts,
  startedInPanel,
  UNNAMED_SESSION,
  type HostProcess,
} from '@memnox/core';

import type { EditHookContext } from './edit-claims';
import { log } from './seam-runtime';
import { cwdOf, fieldsOf, sessionOf } from './hook-payload';
import { sessionStartOf } from './session-context-hook';

/**
 * Where a session's agent runs on screen, noted by the hook at session start because the
 * hook is the one Memnox process that runs inside the agent's own process tree.
 */

const PS_TIMEOUT_MS = 2000;

/**
 * Written down once per session, so "show me" knows which window the agent is in: at its start,
 * or at the first hook after it for a session that began before Memnox was there to see it.
 */
export async function noteSessionHost(
  payload: unknown,
  context: EditHookContext,
  listing: () => string = psListing,
): Promise<void> {
  const start = sessionStartOf(payload) ?? (await unnotedSession(payload, context));
  if (start === null) return;
  const sessionId =
    context.runSession ?? (start.sessionId === '' ? UNNAMED_SESSION : start.sessionId);
  try {
    const chain = readableChain(process.ppid, listing);
    const agent = agentProcessOf(chain);
    const ran = await runPlace(context);
    const { tty, ...place } = ran ?? hostOf(chain);
    const panel = startedInPanel(context.entrypoint);
    await new SessionHosts(context.home).note({
      sessionId,
      agent: context.agent,
      pid: ran?.pid ?? agent?.pid ?? process.ppid,
      ...place,
      ...(panel ? { panel } : tty === undefined ? {} : { tty }),
      cwd: start.cwd ?? context.cwd,
      ...(start.sessionId === '' || start.sessionId === sessionId
        ? {}
        : { agentSession: start.sessionId }),
      seenAt: context.now().toISOString(),
    });
  } catch (err) {
    // Showing the window is a convenience: a session is never held up for it.
    log(`could not note where the session runs: ${String(err)}`);
  }
}

/**
 * The tab `memnox run` noted for itself before its agent began. An agent that runs its tools in a
 * terminal of its own, as Cursor's does, would otherwise be noted on that inner one, which no tab holds.
 */
async function runPlace(
  context: EditHookContext,
): Promise<{ pid: number; tty?: string; app?: string; appPath?: string } | null> {
  if (context.runSession === undefined) return null;
  const run = await new RunTerminals(context.home)
    .read(context.runSession)
    .catch(() => null);
  if (run === null || run.tty === undefined) return null;
  return {
    pid: run.pid,
    tty: run.tty,
    ...(run.app === undefined ? {} : { app: run.app }),
    ...(run.appPath === undefined ? {} : { appPath: run.appPath }),
  };
}

/** Any other hook of a session nobody has noted yet, read as if it were the start. */
async function unnotedSession(
  payload: unknown,
  context: EditHookContext,
): Promise<{ sessionId: string; cwd?: string } | null> {
  const hook = fieldsOf(payload);
  if (hook === null) return null;
  const sessionId = sessionOf(hook);
  const keyed = context.runSession ?? sessionId;
  if (keyed === '' || (await new SessionHosts(context.home).read(keyed)) !== null)
    return null;
  const cwd = cwdOf(hook);
  return { sessionId, ...(cwd === undefined ? {} : { cwd }) };
}

/**
 * The processes from `pid` upward, nearest first, from one `ps`. `comm` goes last so a path
 * with spaces in it, such as `Visual Studio Code.app`, arrives whole.
 */
export function processChain(
  pid: number,
  listing: () => string = psListing,
): HostProcess[] {
  const table = new Map<number, HostProcess & { ppid: number }>();
  for (const line of listing().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const [, own, parent, tty, command] = match;
    table.set(Number(own), {
      pid: Number(own),
      ppid: Number(parent),
      tty: tty ?? '',
      command: (command ?? '').trim(),
    });
  }
  const chain: HostProcess[] = [];
  let current = table.get(pid);
  while (current !== undefined && chain.length < 32) {
    chain.push({ pid: current.pid, command: current.command, tty: current.tty });
    if (current.ppid <= 1) break;
    current = table.get(current.ppid);
  }
  return chain;
}

/** Empty when `ps` cannot be run, which leaves the session noted without its app. */
function readableChain(pid: number, listing: () => string): HostProcess[] {
  try {
    return processChain(pid, listing);
  } catch {
    // A sandbox or a minimal system without ps: the pid and folder are still worth keeping.
    return [];
  }
}

function psListing(): string {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,tty=,comm='], {
    encoding: 'utf8',
    timeout: PS_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}
