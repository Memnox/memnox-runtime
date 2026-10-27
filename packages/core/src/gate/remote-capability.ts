/**
 * What a paired device may do, as data the runtime decides and the apps only display. A remote
 * request is looked up here by the device the Noise handshake proved, never by a token or a header.
 * Kept apart from the gate's tables so a screen that runs no Node can name a capability.
 */
export const REMOTE_CAPABILITY = {
  SEE: 'see',
  ASK: 'ask',
  /** A held call, or a proposal answering one. */
  ANSWER: 'answer',
  /** Stopping, freezing or resuming, and the person's own follow up typed into a session. */
  STEER: 'steer',
  RULES: 'rules',
  REWIND: 'rewind',
  /** Driving, and a proposal for something only the Mac can do. */
  MAC: 'mac',
} as const;

export type RemoteCapability = (typeof REMOTE_CAPABILITY)[keyof typeof REMOTE_CAPABILITY];
