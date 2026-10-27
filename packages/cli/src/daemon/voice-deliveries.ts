import {
  DELIVERY,
  DisplayRequests,
  type DaemonRequest,
  type DaemonResponse,
  type Delivery,
  type DisplayDelivery,
} from '@memnox/core';
import { recordDelivery } from './record-delivery';

/**
 * What the Mac reports back after acting or looking, kept for the brain that is waiting on it,
 * and for a delivery written into the agent's session as well, so it can be shown later.
 */

/** Whether a typed instruction landed, kept for the brain that is waiting to say so. */
export async function deliveredAnswer(
  home: string,
  request: DaemonRequest,
  at: string,
  on?: string,
): Promise<DaemonResponse> {
  const outcome = request.answer;
  if (request.subject === undefined || !isDelivery(outcome)) {
    return {
      id: request.id,
      ok: false,
      error: 'delivered needs a subject and an outcome',
    };
  }
  // A claim that it landed with nothing read back is only a claim, so it is kept as typed.
  const answer =
    outcome === DELIVERY.VERIFIED && request.proof === undefined
      ? DELIVERY.TYPED
      : outcome;
  const reason = request.reason === undefined ? {} : { reason: request.reason };
  const proof = request.proof === undefined ? {} : { proof: request.proof };
  const told = request.told === true ? { told: true } : {};
  const evidence = request.evidence === undefined ? {} : { evidence: request.evidence };
  const kept = await keep(home, request.subject, {
    outcome: answer,
    at,
    ...reason,
    ...proof,
    ...told,
    ...evidence,
    ...(on === undefined ? {} : { on }),
  });
  return { id: request.id, ok: true, outcome: kept ? 'kept' : 'nobody waiting' };
}

/** Kept for the brain, and written into the session it was typed for, when that request is still there. */
async function keep(
  home: string,
  subject: string,
  delivery: DisplayDelivery,
): Promise<boolean> {
  const requests = new DisplayRequests(home);
  const shown = await requests.read(subject);
  const kept = await requests.deliver(subject, delivery);
  if (shown !== null) {
    await recordDelivery(home, {
      ...delivery,
      sessionId: shown.sessionId,
      agent: shown.agent,
      text: shown.text ?? shown.title,
    });
  }
  return kept;
}

/** What the Mac saw when the brain asked to look, kept for the brain that is waiting on it. */
export async function seenAnswer(
  home: string,
  request: DaemonRequest,
): Promise<DaemonResponse> {
  if (request.subject === undefined || request.sight === undefined) {
    return { id: request.id, ok: false, error: 'seen needs a subject and a sight' };
  }
  const kept = await new DisplayRequests(home).see(request.subject, request.sight);
  return { id: request.id, ok: true, outcome: kept ? 'kept' : 'nobody waiting' };
}

const DELIVERIES: readonly string[] = Object.values(DELIVERY);

function isDelivery(value: string | undefined): value is Delivery {
  return value !== undefined && DELIVERIES.includes(value);
}

/** The phone reporting a page, and whether that page was sent to it. */
interface PhoneReport {
  name: string;
  sentToIt: boolean;
}

/** How a page went on the phone it was sent to, kept with that phone's name; any other subject is refused. */
export async function phoneDeliveredAnswer(
  home: string,
  request: DaemonRequest,
  at: string,
  phone: PhoneReport,
): Promise<DaemonResponse> {
  if (!phone.sentToIt) {
    return {
      id: request.id,
      ok: false,
      error: `${phone.name} was sent nothing by that subject`,
      outcome: 'refused',
    };
  }
  return deliveredAnswer(home, request, at, phone.name);
}
