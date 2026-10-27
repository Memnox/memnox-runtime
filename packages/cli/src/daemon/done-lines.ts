import { basename } from 'node:path';
import { DELIVERY, DISPLAY, type DaemonEvent } from '@memnox/core';

/**
 * The one line a phone speaks once the Mac did something it asked for. Built from what was
 * shown and how the Mac said it went, never from what the agent claimed.
 */

/** Said to the phone when nobody has the Mac app open to do it, rather than leaving it to wait. */
export const OPEN_THE_MAC = 'Open Memnox on your Mac to do that';

/** Said when the phone was never allowed to act on the Mac. */
export const NOT_ALLOWED_ON_MAC =
  'This phone may not act on your Mac yet. Allow it from the Mac with Touch ID first';

/** How the Mac said a look ended, beside the deliveries a typed instruction has. */
export const SEEN = 'seen';

const WENT_IN: readonly string[] = [DELIVERY.TYPED, DELIVERY.VERIFIED, SEEN];

/** The line for a show the Mac finished, in the words a phone can speak as they are. */
export function doneText(event: DaemonEvent, agentName: string, outcome: string): string {
  if (outcome === DELIVERY.WAITING) return `It goes to ${agentName} at its next prompt`;
  if (!WENT_IN.includes(outcome)) return 'That did not work on your Mac';
  if (event.display === DISPLAY.TYPE || event.display === DISPLAY.PREFILL) {
    return `Typed it into ${agentName}`;
  }
  if (event.display === DISPLAY.OPEN || event.display === DISPLAY.FOCUS) {
    return `Brought ${agentName} forward`;
  }
  if (event.display === DISPLAY.LAUNCH) return `Started ${agentName} on your Mac`;
  if (event.display === DISPLAY.CLOSE) return `Closed ${agentName}`;
  if (event.display === DISPLAY.INTERRUPT) return `Stopped ${agentName}`;
  if (event.display === DISPLAY.FOLDER) return 'Opened the folder on your Mac';
  if (event.display === DISPLAY.LOOK) return 'Looked at your screen';
  if (event.display === DISPLAY.DISMISS) return 'Cleared your screen';
  return `Opened ${event.title ?? agentName} on your Mac`;
}

/** What the phone is asked to sign for, in words: the action and where it lands. */
export function macRationale(event: DaemonEvent, agentName: string): string {
  if (event.display === DISPLAY.TYPE || event.display === DISPLAY.PREFILL) {
    return `Type into ${agentName} on your Mac: ${event.summary}`;
  }
  if (event.display === DISPLAY.LAUNCH) {
    const cwd = event.host?.cwd;
    const where = cwd === undefined ? '' : ` in ${basename(cwd)}`;
    return `Start ${agentName}${where} on your Mac`;
  }
  if (event.display === DISPLAY.CLOSE) return `Close ${agentName} on your Mac`;
  if (event.display === DISPLAY.INTERRUPT) return `Stop ${agentName} on your Mac`;
  if (event.display === DISPLAY.FOLDER) return `Open ${event.summary} on your Mac`;
  return `On your Mac: ${event.title ?? event.summary}`;
}
