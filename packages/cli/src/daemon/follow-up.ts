import {
  Devices,
  FOLLOW_UP_OUTCOME,
  followUpMessage,
  holds,
  REMOTE_CAPABILITY,
  SpokenInstructions,
  verifiesSigned,
  type DaemonRequest,
  type DaemonResponse,
  type DeviceRecord,
  type FollowUpOutcome,
} from '@memnox/core';
import { refused } from '../remote/pairings';
import { HOW_IN_APP } from '../session-tools/app-follow-up';
import { sendInstructionTool } from '../session-tools/instruct-tools';
import type { RemotePrincipal } from './confirm';
import type { OriginRouter } from './origin-routing';
import type { SessionViews } from './session-view';

/**
 * The person's own words typed into one session from a phone's composer or the Mac: sent as they
 * are with no brain reading them first, and only under a signature over that session and those words.
 */

/** Long enough for any follow up a person types, short enough that a pasted file is refused rather than typed. */
const MOST_FOLLOW_UP_CHARS = 8_000;

export interface FollowUpDeps {
  home: string;
  now: () => string;
  /** The agent a session runs, or null when this machine has no such session. */
  agentOf: (sessionId: string) => Promise<string | null>;
  /** Hands an instruction to its session the way the voice does once the person said yes. */
  send: (instructionId: string) => Promise<unknown>;
}

/** The daemon's own seams: the session's agent from its view, and the words sent the way send_instruction sends them. */
export function followUpDeps(
  voice: { home: string; now: () => string },
  views: Pick<SessionViews, 'view' | 'deps'>,
  router: Pick<OriginRouter, 'asked'>,
): FollowUpDeps {
  return {
    home: voice.home,
    now: voice.now,
    agentOf: async (sessionId) => (await views.view(sessionId))?.agent ?? null,
    send: (instruction) => {
      // A question the Mac began, so what the Mac types for it is never read as a phone's show to sign again.
      router.asked(undefined, voice.now());
      return sendInstructionTool(views.deps(), { instruction }, undefined, undefined, {
        typedWhileWorking: true,
      });
    },
  };
}

/** What handing the words over came to, as send_instruction reports it. */
interface Sent {
  sent?: boolean;
  how?: string;
  why?: string;
}

/** The routes send_instruction names, read as the three a screen can say. */
const OUTCOME_OF: Readonly<Record<string, FollowUpOutcome>> = {
  queued: FOLLOW_UP_OUTCOME.QUEUED,
  typed: FOLLOW_UP_OUTCOME.TYPED,
  prefilled: FOLLOW_UP_OUTCOME.TYPED,
  resumed: FOLLOW_UP_OUTCOME.TYPED,
  [HOW_IN_APP]: FOLLOW_UP_OUTCOME.TYPED,
  later: FOLLOW_UP_OUTCOME.LATER,
};

export async function followUpAnswer(
  request: DaemonRequest,
  deps: FollowUpDeps,
  principal?: RemotePrincipal,
): Promise<DaemonResponse> {
  const sessionId = request.sessionId ?? '';
  const words = request.said ?? '';
  if (sessionId.trim() === '' || words.trim() === '') {
    return refused(request, 'A follow up needs a session and the words to send it.');
  }
  if (words.length > MOST_FOLLOW_UP_CHARS) {
    return refused(request, 'That is too long to type into an agent in one go.');
  }
  const signer = await signerOf(deps.home, request, principal);
  if (signer === null || !holds(signer, REMOTE_CAPABILITY.STEER)) {
    const where =
      principal === undefined
        ? 'Touch ID on this Mac'
        : `Face ID on ${principal.device.name}`;
    return refused(request, `Sending words to an agent needs ${where}.`);
  }
  const agent = await deps.agentOf(sessionId);
  if (agent === null)
    return refused(request, 'That session is not on this Mac any more.');
  const instruction = await new SpokenInstructions(deps.home).propose({
    sessionId,
    agent,
    message: words,
    at: deps.now(),
  });
  const sent = ((await deps.send(instruction.id)) ?? {}) as Sent;
  const outcome = sent.how === undefined ? undefined : OUTCOME_OF[sent.how];
  if (sent.sent !== true || outcome === undefined) {
    return refused(request, sent.why ?? 'The Mac could not hand that to the agent.');
  }
  return { id: request.id, ok: true, outcome };
}

/** The device whose key signed the words: only the phone they came from, or any trusted device at the Mac. */
async function signerOf(
  home: string,
  request: DaemonRequest,
  principal?: RemotePrincipal,
): Promise<DeviceRecord | null> {
  if (request.signature === undefined) return null;
  const message = followUpMessage(request.sessionId ?? '', request.said ?? '');
  if (principal === undefined)
    return new Devices(home).signerOf(message, request.signature);
  return verifiesSigned(principal.device.signingPoint, message, request.signature)
    ? principal.device
    : null;
}
