/** A held call's yes bound to the exact call: the digest a screen signs, and the one it says it signed. */

export interface HeldActionEventFields {
  /** On HELD, and on every held call WAITING lists: the digest a v4 confirmation signs. */
  actionDigest?: string;
}

export interface HeldActionRequestFields {
  /** On CONFIRM of a held call: the digest the screen signed, so a call changed since is refused by name. */
  actionDigest?: string;
}
