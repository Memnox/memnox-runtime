/**
 * Questions a team routed to the person reach only the devices that hold their sign in, never this
 * machine. A device names them when it asks the voice, so "allow it" can mean one of them, and the
 * answer goes back to that device as a proposal it carries out with the workspace.
 */

/** A question the team routed to the person, as a device tells the voice about it. */
export interface TeamCallBrief {
  /** The workspace's id for the call, the subject a device signs a yes over. */
  id: string;
  /** "Codex on build-box, from Ana's team", the same label every door shows. */
  label: string;
  /** What it wants, in plain words. */
  what: string;
}

/** On a proposal: the answer a device carries out with the workspace before it confirms here. */
export interface TeamAnswerBrief {
  callId: string;
  answer: string;
  label: string;
}
