/** A sign in the daemon has under way: the code to approve and where, as the Mac app shows them. */
export interface PersonSignInCode {
  userCode: string;
  page?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Whether a person is signed in on the daemon's side. The Mac app keeps its own credential for
 * answering from the notch; the voice's tools and `memnox inbox` go through this one.
 */
export interface PersonStanding {
  signedIn: boolean;
  name?: string;
  workspaceId?: string;
  /** A sign in under way, until it is approved or runs out. */
  code?: PersonSignInCode;
  /** Why the last sign in stopped, kept until the next one starts. */
  failed?: string;
}

/**
 * Whether this machine is connected to a workspace, the credential `memnox login` writes, which is what
 * carries rules, workspace memory and phone pairing to it. The same shape as a person's standing, with the
 * workspace's name where a person's would be, so the Mac app shows both with one piece of code.
 */
export interface MachineStanding {
  signedIn: boolean;
  /** The workspace's name, once the workspace has said it. */
  name?: string;
  workspaceId?: string;
  machineId?: string;
  /** A connection under way, until it is approved or runs out. */
  code?: PersonSignInCode;
  /** Why the last connection stopped, or that the workspace let this machine go. */
  failed?: string;
}
