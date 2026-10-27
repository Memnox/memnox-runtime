import { DAEMON_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { DictationBrain } from '../operator/dictation-brain';

/**
 * The Mac's dictation, polished by the person's own Claude Code, kept warm for it. The Mac has already cleaned it
 * with fixed rules and is waiting with that version in hand, so a failure here costs the person nothing.
 */

/** One warm process per home, made on first use. */
const brains = new Map<string, DictationBrain>();

function brainFor(home: string): DictationBrain {
  let brain = brains.get(home);
  if (brain === undefined) {
    brain = new DictationBrain(home);
    brains.set(home, brain);
  }
  return brain;
}

export function isPolishMethod(method: string): boolean {
  return method === DAEMON_METHOD.POLISH || method === DAEMON_METHOD.POLISH_WARM;
}

export async function answerPolish(
  home: string,
  request: DaemonRequest,
  brain: DictationBrain = brainFor(home),
): Promise<DaemonResponse> {
  if (request.method === DAEMON_METHOD.POLISH_WARM) {
    // Answered at once: the key is down and the person is already talking while it starts.
    void brain.warm().catch(() => undefined);
    return { id: request.id, ok: true };
  }
  const said = request.said ?? '';
  if (said.trim() === '')
    return { id: request.id, ok: false, error: 'polish needs what was said' };
  const polished = await brain.polish({
    said,
    ...(request.family === undefined ? {} : { family: request.family }),
    ...(request.vocabulary === undefined ? {} : { vocabulary: request.vocabulary }),
    ...(request.selection === undefined ? {} : { selection: request.selection }),
  });
  return polished === null
    ? { id: request.id, ok: false, error: 'Claude Code did not polish it' }
    : { id: request.id, ok: true, polished };
}
