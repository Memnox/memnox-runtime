import {
  answeredBy,
  Devices,
  holds,
  verifiesSigned,
  type DeviceRecord,
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
  const signer = await signerOf(home, input);
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
async function signerOf(home: string, input: ConfirmInput): Promise<DeviceRecord | null> {
  if (input.signature === undefined) return null;
  const message = signedMessage(input);
  const principal = input.principal?.device;
  if (principal === undefined)
    return new Devices(home).signerOf(message, input.signature);
  return verifiesSigned(principal.signingPoint, message, input.signature)
    ? principal
    : null;
}
