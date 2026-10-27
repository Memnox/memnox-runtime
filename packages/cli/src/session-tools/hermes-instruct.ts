import { spawn } from 'node:child_process';
import { HERMES_SESSION_PREFIX } from '../daemon/hermes-view';

/**
 * Hermes takes a turn on an existing session from its own command line, with no terminal and no
 * Mac to type into, which is how an instruction reaches it on a server reached over SSH.
 */

/** Starts Hermes on one turn of a session in the background; false when it could not be started. */
export type ResumeHermes = (sessionId: string, words: string) => boolean;

export const resumeHermes: ResumeHermes = (sessionId, words) => {
  const id = sessionId.slice(HERMES_SESSION_PREFIX.length);
  try {
    // Detached and unwatched, since the turn outlives this answer; its actions are ruled by the seams as ever.
    const child = spawn('hermes', ['chat', '--resume', id, '--oneshot', '-q', words], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
};

/** What the brain may say once Hermes was started on it, and when it could not be. */
export const HERMES_SAID = {
  started:
    'Hermes was started on it in that same session, so it is working on it now. Say so in a few words.',
  failed:
    'Hermes could not be started on this machine, so it has not got this. Say that plainly and offer to try again.',
} as const;
