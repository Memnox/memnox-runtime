import { DECISION_EFFECT } from '../constants/decision.constants';
import { ENFORCEMENT_MODE } from '../constants/enforcement.constants';
import type { Delivery, DeliveryProof } from '../daemon/delivery';
import { TOOL_CLASS } from '../discovery/classify';
import { digest } from '../domain/digest';
import {
  ACTOR_TYPE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  type MemnoxEvent,
} from '../event/event';
import { newEventId } from '../event/seam-row';

/**
 * What the Mac did with the person's spoken instruction, written into the agent's session as
 * the person's own row, so `why` and the black box show whether it landed and how that was known.
 * The words themselves never go in, only their digest, as every other row.
 */

export const DELIVERY_OPERATION = 'voice.delivered';

export interface DeliveryRowInput {
  sessionId: string;
  agent: string;
  /** The instruction as it was typed, kept only as a digest. */
  text: string;
  outcome: Delivery;
  reason?: string;
  proof?: DeliveryProof;
  at: string;
}

const HOW: Record<Delivery, string> = {
  verified: 'typed it in and saw it land',
  typed: 'typed it in, though nothing read it back',
  waiting: 'left it for its next prompt rather than take the window',
  clipboard: 'could not type it in safely and left it on the clipboard',
  'not-allowed': 'was not allowed to type and left it on the clipboard',
  failed: 'could not type it in',
};

export function deliveryRow(input: DeliveryRowInput): MemnoxEvent {
  const { proof } = input;
  const checked = proof === undefined ? '' : `, checked by ${proof.checked}`;
  const image = proof?.image === undefined ? '' : `, screenshot at ${proof.image}`;
  const why = input.reason === undefined ? '' : `, because ${input.reason}`;
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: input.at,
    sessionId: input.sessionId,
    agent: input.agent,
    actorType: ACTOR_TYPE.HUMAN,
    principal: 'person (voice)',
    surface: EVENT_SURFACE.QUESTION,
    operation: DELIVERY_OPERATION,
    target: input.outcome,
    class: TOOL_CLASS.COMMUNICATION,
    // Nothing was ruled on here, only reported, so the row allows what the person already said yes to.
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: `Memnox ${HOW[input.outcome]} for ${input.agent}${checked}${image}${why}`,
    argsDigest: digest(input.text),
  };
}
