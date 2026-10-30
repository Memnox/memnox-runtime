import {
  actionConfirmationMessage,
  actionDigestOf,
  answeredBy,
  Devices,
  holds,
  verifiesSigned,
  type DeviceRecord,
  type HoldRequest,
  type RemoteCapability,
} from '@memnox/core';
import type { ConfirmInput } from './confirm';
import { signedMessage } from './confirm-edit';

/**
 * Whether an answer counts and who the ledger names for it: a refusal never needs proof, and a yes
 * carries a signature from a trusted device unless it stays inside its session or comes from the driver.
 */

/** Who the ledger says answered, since a refusal arrives unsigned and an allow does not. */
const BY_VOICE = 'person (voice)';
/** A yes to a call that stays inside its session's repository, which needs no fingerprint. */
const IN_SESSION = 'person (inside the session)';

const UNSIGNED =
  'letting something happen needs Touch ID, and this answer carries no valid signature';

/** What an answer needs before it counts. */
export interface Needs {
  refusing: boolean;
  /** Null when nothing but the Mac may answer it. */
  capability: RemoteCapability | null;
  /** A held call inside its session's repository, which the Mac may allow without Touch ID. */
  withinSession: boolean;
  /** A Mac proposal from the device driving the Mac now, which runs without Face ID. */
  driven: boolean;
  /** On a held call: the call as held here, whose digest a v4 signature must cover. */
  heldCall?: HoldRequest;
}

/** A yes signed over a call that is no longer the call held, which is never taken as a yes to the new one. */
const CHANGED_SINCE_SHOWN =
  'this call changed after it was shown, so the yes signed for it does not cover it';

/**
 * The digest a held call's yes must cover, worked out again from the call held here and never taken
 * from the screen, or why the yes no longer covers it. Only a yes is asked this, since a no widens nothing.
 */
function boundAction(
  request: HoldRequest | undefined,
  input: Pick<ConfirmInput, 'actionDigest'>,
): { actionDigest?: string } | { refused: string } {
  if (request === undefined) return {};
  const actionDigest = actionDigestOf(request);
  if (input.actionDigest !== undefined && input.actionDigest !== actionDigest)
    return { refused: CHANGED_SINCE_SHOWN };
  return { actionDigest };
}

/** Who answered, in the ledger's words, or why the answer does not count. */
export async function consentFor(
  home: string,
  input: ConfirmInput,
  needs: Needs,
): Promise<{ by: string } | { refused: string }> {
  const principal = input.principal?.device;
  if (
    principal !== undefined &&
    (needs.capability === null || !holds(principal, needs.capability))
  ) {
    return { refused: `${principal.name} may not answer that from afar` };
  }
  if (needs.refusing)
    return { by: principal === undefined ? BY_VOICE : `person (${principal.name})` };
  const bound = boundAction(needs.heldCall, input);
  if ('refused' in bound) return bound;
  const signer = await signerOf(home, input, bound.actionDigest);
  if (signer !== null) {
    const lacks = needs.capability !== null && !holds(signer, needs.capability);
    return lacks
      ? { refused: `${signer.name} may not allow that` }
      : { by: answeredBy(signer) };
  }
  if (principal !== undefined) {
    return needs.driven
      ? { by: `person (driving from ${principal.name})` }
      : {
          refused: `allowing from ${principal.name} needs Face ID, and this answer carries no valid signature`,
        };
  }
  return needs.withinSession ? { by: IN_SESSION } : { refused: UNSIGNED };
}

/** The device whose key signed this answer: only the phone it came from, or any trusted device at the Mac. */
async function signerOf(
  home: string,
  input: ConfirmInput,
  actionDigest: string | undefined,
): Promise<DeviceRecord | null> {
  const signature = input.signature;
  if (signature === undefined) return null;
  const principal = input.principal?.device;
  for (const message of messagesOf(input, actionDigest)) {
    const signer =
      principal === undefined
        ? await new Devices(home).signerOf(message, signature)
        : verifiesSigned(principal.signingPoint, message, signature)
          ? principal
          : null;
    if (signer !== null) return signer;
  }
  return null;
}

/** The v4 words bound to the call first, then the older words a screen not yet moved to v4 still signs. */
function messagesOf(input: ConfirmInput, actionDigest: string | undefined): string[] {
  const older = signedMessage(input);
  return actionDigest === undefined
    ? [older]
    : [actionConfirmationMessage(input.subject, input.answer, actionDigest), older];
}
