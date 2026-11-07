/**
 * Reaching this machine over the local network rather than the relay: off until the person turns
 * it on, the same Noise sessions either way, and only ever a private address.
 */

export const LAN_METHOD = {
  /** Whether the local network is on, where it listens, whether it is advertised, and which phones reach it. */
  LAN_STATUS: 'lan-status',
  /** Turns it off at once, or proposes turning it on, which holds once the person signs it on the Mac. */
  LAN_SET: 'lan-set',
} as const;

/** A paired phone with a live session over the local network now. */
export interface LanPhone {
  deviceId: string;
  name: string;
}

export interface LanStatus {
  /** The person's setting: off until they turn it on. */
  on: boolean;
  /** A listener is up, which also needs a private address on this machine. */
  listening: boolean;
  /** The private addresses it listens on; empty while off or with no private network. */
  addresses: string[];
  /** The port each address listens on, while listening. */
  port?: number;
  /** Announced over Bonjour as `_memnox._tcp` under a random name that says nothing of the machine. */
  advertised: boolean;
  /** That random name, which the QR carries so a phone knows which announcement is this machine. */
  instance?: string;
  reachable: LanPhone[];
}

export interface LanRequestFields {
  /** On LAN_SET: true proposes turning it on, false turns it off now. */
  lanOn?: boolean;
}

export interface LanResponseFields {
  /** On LAN_STATUS and LAN_SET. */
  lan?: LanStatus;
}
