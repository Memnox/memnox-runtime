import {
  exchangePublicOf,
  newExchangeKeyPair,
  SYNC_KEY_BYTES,
  type ExchangeKeyPair,
  type SecretStore,
} from '@memnox/core';

/**
 * The two secrets personal sync keeps, both in the OS secret store and never in a file: the sync
 * key that seals every item, and this machine's X25519 private key that opens the envelope another
 * of the person's machines seals that key into.
 */

const SYNC_KEY_SECRET = 'memnox-personal-sync-key';
const EXCHANGE_SECRET = 'memnox-personal-sync-exchange';

/** The sync key this machine holds, or undefined before it made or accepted one. */
export async function readSyncKey(secrets: SecretStore): Promise<Buffer | undefined> {
  const kept = await secrets.get(SYNC_KEY_SECRET);
  if (kept === undefined) return undefined;
  const key = Buffer.from(kept, 'base64');
  return key.length === SYNC_KEY_BYTES ? key : undefined;
}

export async function keepSyncKey(secrets: SecretStore, key: Buffer): Promise<void> {
  await secrets.set(SYNC_KEY_SECRET, key.toString('base64'));
}

/** This machine's exchange key pair, made and kept the first time it is asked for. */
export async function exchangeKeys(secrets: SecretStore): Promise<ExchangeKeyPair> {
  const kept = await secrets.get(EXCHANGE_SECRET);
  if (kept !== undefined) {
    try {
      return { privateKey: kept, publicKey: exchangePublicOf(kept) };
    } catch {
      // A value that is not a key was not written by this; a fresh pair replaces it, and the cloud drops the old envelope.
    }
  }
  const pair = newExchangeKeyPair();
  await secrets.set(EXCHANGE_SECRET, pair.privateKey);
  return pair;
}
