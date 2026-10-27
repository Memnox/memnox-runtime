import { askDaemonOnce, followDaemon } from '@memnox/interceptors';
import type { DaemonRequest, DaemonResponse } from '@memnox/core';

/**
 * A command's way to the local daemon for pairing and devices: one answer, or every line a
 * request streams until the caller stops listening. Injected so a test needs no socket.
 */
export interface DaemonDial {
  /** The first line back, or null when no daemon answered in time. */
  ask(request: DaemonRequest): Promise<DaemonResponse | null>;
  /** Every line back until the returned stop is called; `gone` runs once if the daemon hangs up first. */
  follow(
    request: DaemonRequest,
    each: (response: DaemonResponse) => void,
    gone: () => void,
  ): () => void;
}

/** Long enough for pair-begin, which waits on the cloud for a mailbox. */
const ASK_TIMEOUT_MS = 20_000;

export function socketDial(home: string): DaemonDial {
  return {
    ask: (request) => askDaemonOnce(home, request, ASK_TIMEOUT_MS),
    follow: (request, each, gone) => followDaemon(home, request, each, gone),
  };
}
