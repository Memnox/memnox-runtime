import type { DisplayDelivery } from '@memnox/core';

/**
 * What the screen showed after the Mac acted, handed to the brain beside the outcome, so what it
 * says happened rests on what was on screen rather than on what it hoped. The pictures stay on the
 * Mac as files; only the words read off the window travel.
 */
export function witnessed(delivery: DisplayDelivery | null): Record<string, unknown> {
  const evidence = delivery?.evidence;
  if (evidence === undefined) return {};
  return {
    untrusted: true,
    screenAfter: {
      app: evidence.app,
      ...(evidence.text === undefined ? {} : { text: evidence.text }),
    },
    evidence: {
      ...(evidence.before === undefined ? {} : { before: evidence.before }),
      ...(evidence.after === undefined ? {} : { after: evidence.after }),
    },
  };
}
