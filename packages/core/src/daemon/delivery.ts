/** How an instruction the Mac was asked to type ended, as DELIVERED reports it in `answer`. */
export const DELIVERY = {
  /** Typed into the agent's prompt and sent, though nothing read it back, so it is not known to have landed. */
  TYPED: 'typed',
  /** Typed and sent, and the Mac read the target back and saw it land, which `proof` says how. */
  VERIFIED: 'verified',
  /** Left for the session's next prompt, since reaching it now would have taken the person's window. */
  WAITING: 'waiting',
  /** It could not be typed safely, so the words were left on the clipboard. */
  CLIPBOARD: 'clipboard',
  /** The Mac is not allowed to press keys until the person turns Memnox on under Accessibility, so the words were left on the clipboard. */
  NOT_ALLOWED: 'not-allowed',
  /** Nothing was typed anywhere. */
  FAILED: 'failed',
} as const;

export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY];

/** What the Mac read back after acting, so a claim that something landed carries what it saw. */
export interface DeliveryProof {
  /** What was checked, in a few words, such as "the words in its terminal tab". */
  checked: string;
  /** The excerpt that was seen, when the check read text. */
  seen?: string;
  /** A screenshot of the target taken after acting, by its path on this Mac. */
  image?: string;
}

/** One window as the Mac saw it: whose it is, a capture of it, and the labels its controls carry. */
export interface Sight {
  app: string;
  window?: string;
  /** The capture, by its path on this Mac; absent when Memnox may not record the screen. */
  image?: string;
  /** Roles, titles and values from the window's accessibility tree, one control per line. */
  outline?: string;
  /** The words in the capture, read on the Mac, so the screen is read without the picture leaving it. */
  text?: string;
}

/**
 * What the screen showed around an action: the target's window just before and just after, by their
 * paths on the Mac, and the words read off the after one there, so what is said about it has a witness.
 */
export interface Witness {
  app: string;
  before?: string;
  after?: string;
  text?: string;
}

/** Typed in either way: sent, whether or not it was read back. */
export function wentIn(outcome: Delivery): boolean {
  return outcome === DELIVERY.TYPED || outcome === DELIVERY.VERIFIED;
}
