import { holds, markVoiceListening, REMOTE_CAPABILITY } from '@memnox/core';
import type { RemotePrincipal } from './confirm';

/**
 * Marks that somebody can answer a held question, so the hooks wait a moment for them: the Mac app,
 * or a paired device that may answer, which on a server reached over SSH is the only one anybody sees.
 */
export async function markListeningFor(
  home: string,
  now: string,
  principal?: RemotePrincipal,
): Promise<void> {
  if (principal !== undefined && !holds(principal.device, REMOTE_CAPABILITY.ANSWER))
    return;
  await markVoiceListening(home, process.pid, now).catch(() => undefined);
}
