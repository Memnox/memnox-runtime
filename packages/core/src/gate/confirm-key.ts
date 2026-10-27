import { createPublicKey, verify } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { confirmationMessage } from './confirm-message';

export { confirmationMessage };

/**
 * The public half of a key only a person's fingerprint can use. The Mac app keeps the private
 * half in the Secure Enclave behind biometry, so a process running as the same user, an
 * agent included, can raise a Touch ID sheet but never produce what a confirmation carries.
 */

export const CONFIRM_KEY_FILE = join('voice', 'confirm-key.json');

/** DER prefix that turns a raw P-256 point into the SPKI form `createPublicKey` reads. */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

/** An uncompressed P-256 point: the 0x04 marker and two 32 byte coordinates. */
const P256_POINT_BYTES = 65;

export interface ConfirmKey {
  /** The X9.63 point, as `SecKeyCopyExternalRepresentation` hands it over, in base64. */
  point: string;
  registeredAt: string;
}

export type RegisterOutcome =
  { registered: ConfirmKey } | { alreadyRegistered: ConfirmKey };

export function confirmKeyPathFor(home: string): string {
  return join(home, MEMNOX_HOME, CONFIRM_KEY_FILE);
}

export function isP256Point(point: string): boolean {
  const bytes = Buffer.from(point, 'base64');
  return bytes.length === P256_POINT_BYTES && bytes[0] === 0x04;
}

/** False for anything that does not verify, a malformed key or signature included. */
export function verifiesConfirmation(
  key: ConfirmKey,
  subject: string,
  answer: string,
  signature: string,
): boolean {
  return verifiesSigned(key.point, confirmationMessage(subject, answer), signature);
}

/** Whether a P-256 point signed exactly these words, for every message a person's key signs. */
export function verifiesSigned(
  point: string,
  message: string,
  signature: string,
): boolean {
  if (!isP256Point(point)) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, Buffer.from(point, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      'sha256',
      Buffer.from(message),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export class ConfirmKeys {
  private readonly path: string;

  constructor(home: string) {
    this.path = confirmKeyPathFor(home);
  }

  read(): Promise<ConfirmKey | null> {
    return readJsonFile<ConfirmKey>(this.path);
  }

  /**
   * Trusted on first use and never replaced from here: a second key would let whoever wrote it
   * confirm for the person. The app checks the key on file is its own and says so when it is not.
   */
  async register(point: string, at: string): Promise<RegisterOutcome> {
    const existing = await this.read();
    if (existing !== null) return { alreadyRegistered: existing };
    const key: ConfirmKey = { point, registeredAt: at };
    await writeJsonFile(this.path, key);
    return { registered: key };
  }

  /** A person's command, run from a terminal, never reachable through the daemon. */
  async forget(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
