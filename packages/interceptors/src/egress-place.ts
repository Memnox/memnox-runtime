import { projectLookup, SessionHosts, type ProjectLookup } from '@memnox/core';

import type { EgressCaller } from './egress-seam';

/**
 * Where an outbound request's session works, so a project's rules decide its traffic as they
 * decide its commands. A request carries no folder, so the folder is the one its session started in.
 */

/** The folder and project a request is ruled on in; empty where neither is known. */
export interface EgressPlace {
  workingDirectory?: string;
  projectId?: string;
}

/** Reads a caller's place; a seam with none rules every request on the machine's rules alone. */
export type EgressPlaceOf = (caller: EgressCaller) => Promise<EgressPlace>;

/**
 * The place a session's host record names, read from this home. Anything unknown, missing or
 * unreadable is no place, so only the machine's rules decide, never fewer.
 */
export function egressPlaces(
  home: string,
  projectAt: ProjectLookup = projectLookup(home),
): EgressPlaceOf {
  const hosts = new SessionHosts(home);
  return async (caller) => {
    const sessionId = caller.sessionId;
    if (sessionId === undefined || sessionId === '') return {};
    // An unreadable record is no place, the same as a session that never noted one.
    const host = await hosts.read(sessionId).catch(() => null);
    const cwd = host === null ? undefined : host.cwd;
    if (cwd === undefined || cwd === '') return {};
    const projectId = await projectAt(cwd);
    return { workingDirectory: cwd, ...(projectId === undefined ? {} : { projectId }) };
  };
}
