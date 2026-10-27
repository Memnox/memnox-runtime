import {
  DAEMON_EVENT,
  UNNAMED_AGENT,
  type DaemonAskChunk,
  type DaemonEvent,
  type DaemonRequest,
  type PhoneTurn,
} from '@memnox/core';
import { BRAIN_CHUNK } from '../operator/brain';
import type { RemotePrincipal } from './confirm';
import { write, type Peer } from './socket-write';
import { ENDS_TURN } from './voice-ask';

/**
 * A phone's conversation shown on the Mac island as it happens: what was said, the answer as it
 * streams, then its end. Written only to the Mac app's own subscriptions on the local socket.
 */

interface MirrorDeps {
  /** Read at every line, so a Mac app that subscribes mid turn sees the rest of it. */
  mac: () => readonly Peer[];
  now: () => string;
}

class PhoneTurnMirror {
  private ended = false;

  constructor(
    private readonly device: { id: string; name: string },
    private readonly deps: MirrorDeps,
  ) {}

  said(words: string): void {
    this.send({ said: words });
  }

  chunk(chunk: DaemonAskChunk): void {
    if (chunk.kind === BRAIN_CHUNK.TEXT && (chunk.text ?? '') !== '') {
      this.send({ answer: chunk.text ?? '' });
    } else if (ENDS_TURN.has(chunk.kind)) this.end();
  }

  /** Once only, so a turn that already ended is never ended twice when it unwinds. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.send({ ended: true });
  }

  private send(part: Omit<PhoneTurn, 'deviceId' | 'name'>): void {
    const phoneTurn: PhoneTurn = {
      deviceId: this.device.id,
      name: this.device.name,
      ...part,
    };
    const event: DaemonEvent = {
      kind: DAEMON_EVENT.NOTICE,
      subject: `phone_turn_${this.device.id}`,
      agent: UNNAMED_AGENT,
      summary: `Talking from ${this.device.name}`,
      at: this.deps.now(),
      phoneTurn,
    };
    for (const peer of this.deps.mac()) write(peer, { id: 0, ok: true, event });
  }
}

/** A mirror for a phone's real question, started with its words; none for the Mac's own or a guess. */
export function mirrorFor(
  principal: RemotePrincipal | undefined,
  request: DaemonRequest,
  deps: MirrorDeps,
): PhoneTurnMirror | null {
  if (principal === undefined || request.speculative === true) return null;
  const mirror = new PhoneTurnMirror(principal.device, deps);
  mirror.said(request.said?.trim() ?? '');
  return mirror;
}
