import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Personal sync's cryptography, all of it on the person's machines: a 32 byte sync key, item ids
 * as an HMAC of kind and name under it, AES-256-GCM over each item with its kind, id and key id
 * bound in, and an X25519 envelope that carries the key to another machine behind a fingerprint.
 */

export const SYNC_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;
const AEAD = 'aes-256-gcm';
const DIGEST = 'sha256';
const KEY_ID_CHARS = 22;
/** Six groups of five digits, about a hundred bits, read aloud or side by side. */
const FINGERPRINT_GROUPS = 6;
const FINGERPRINT_GROUP_BYTES = 5;
const FINGERPRINT_GROUP_MOD = 100_000;
const FINGERPRINT_GROUP_DIGITS = 5;

const LABEL = {
  KEY_ID: 'memnox-personal-sync/key-id/v1',
  ITEM_KEY: 'memnox-personal-sync/items/v1',
  ID_KEY: 'memnox-personal-sync/ids/v1',
  ITEM_DATA: 'memnox-personal-sync/item/v1',
  ENVELOPE: 'memnox-personal-sync/envelope/v1',
  PAIR: 'memnox-personal-sync/pair/v1',
} as const;

/** A fresh sync key, made once on the first of the person's machines. */
export function newSyncKey(): Buffer {
  return randomBytes(SYNC_KEY_BYTES);
}

/** Which key sealed an item, derived from the key so no machine has to be told it. */
export function syncKeyIdOf(key: Buffer): string {
  return createHash(DIGEST)
    .update(`${LABEL.KEY_ID}\0`)
    .update(key)
    .digest('base64url')
    .slice(0, KEY_ID_CHARS);
}

function subkey(key: Buffer, label: string, salt: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.from(hkdfSync(DIGEST, key, salt, label, SYNC_KEY_BYTES));
}

/** An item's id: its kind and name under the sync key, so the cloud never learns a name. */
export function syncItemIdOf(key: Buffer, kind: string, name: string): string {
  return createHmac(DIGEST, subkey(key, LABEL.ID_KEY))
    .update(`${kind}\0${name}`)
    .digest('base64url');
}

function itemData(kind: string, id: string, keyId: string): Buffer {
  return Buffer.from(`${LABEL.ITEM_DATA}\0${kind}\0${id}\0${keyId}`, 'utf8');
}

/** An item sealed for the cloud: compressed, then AES-256-GCM with kind, id and key id bound in. */
export function sealSyncItem(
  key: Buffer,
  item: { kind: string; id: string; plaintext: string },
): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(AEAD, subkey(key, LABEL.ITEM_KEY), nonce);
  cipher.setAAD(itemData(item.kind, item.id, syncKeyIdOf(key)));
  const body = Buffer.concat([
    cipher.update(deflateRawSync(Buffer.from(item.plaintext, 'utf8'))),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([FORMAT_VERSION]),
    nonce,
    body,
    cipher.getAuthTag(),
  ]).toString('base64');
}

/** The item's text, or undefined where it was not sealed under this key for this kind and id. */
export function openSyncItem(
  key: Buffer,
  item: { kind: string; id: string; ciphertext: string },
): string | undefined {
  const sealed = Buffer.from(item.ciphertext, 'base64');
  if (sealed.length < 1 + NONCE_BYTES + TAG_BYTES || sealed[0] !== FORMAT_VERSION)
    return undefined;
  const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(AEAD, subkey(key, LABEL.ITEM_KEY), nonce);
    decipher.setAAD(itemData(item.kind, item.id, syncKeyIdOf(key)));
    decipher.setAuthTag(tag);
    const body = sealed.subarray(1 + NONCE_BYTES, sealed.length - TAG_BYTES);
    return inflateRawSync(
      Buffer.concat([decipher.update(body), decipher.final()]),
    ).toString('utf8');
  } catch {
    // A tag that does not verify is an item somebody else sealed, or one tampered with: never read.
    return undefined;
  }
}

/** One machine's X25519 key pair, the private half as base64 PKCS8 so a secret store keeps one line. */
export interface ExchangeKeyPair {
  publicKey: string;
  privateKey: string;
}

export function newExchangeKeyPair(): ExchangeKeyPair {
  const { privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: rawPublicOf(createPublicKey(privateKey)),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** The public half of a kept private key, so only the private half needs keeping. */
export function exchangePublicOf(privateKey: string): string {
  return rawPublicOf(createPublicKey(privateOf(privateKey)));
}

function privateOf(privateKey: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawPublicOf(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.from(String(jwk.x), 'base64url').toString('base64');
}

function publicOf(raw: string): KeyObject {
  const x = Buffer.from(raw, 'base64').toString('base64url');
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
}

/** The words both machines show, the same on each, over the two public keys in either order. */
export function pairFingerprint(one: string, two: string): string {
  const [first, second] = [one, two].sort();
  const hash = createHash(DIGEST)
    .update(`${LABEL.PAIR}\0`)
    .update(Buffer.from(first ?? '', 'base64'))
    .update(Buffer.from(second ?? '', 'base64'))
    .digest();
  const groups: string[] = [];
  for (let at = 0; at < FINGERPRINT_GROUPS; at += 1) {
    const value = hash.readUIntBE(at * FINGERPRINT_GROUP_BYTES, FINGERPRINT_GROUP_BYTES);
    groups.push(
      String(value % FINGERPRINT_GROUP_MOD).padStart(FINGERPRINT_GROUP_DIGITS, '0'),
    );
  }
  return groups.join(' ');
}

function envelopeKey(input: {
  privateKey: string;
  peer: string;
  sender: string;
  receiver: string;
}): Buffer {
  const shared = diffieHellman({
    privateKey: privateOf(input.privateKey),
    publicKey: publicOf(input.peer),
  });
  const salt = Buffer.concat([
    Buffer.from(input.sender, 'base64'),
    Buffer.from(input.receiver, 'base64'),
  ]);
  return subkey(shared, LABEL.ENVELOPE, salt);
}

function envelopeData(keyId: string): Buffer {
  return Buffer.from(`${LABEL.ENVELOPE}\0${keyId}`, 'utf8');
}

const PUBLIC_BYTES = 32;

/** The sync key sealed to another machine's public key, naming the sender's so the receiver can show the fingerprint. */
export function sealEnvelope(input: {
  syncKey: Buffer;
  sender: ExchangeKeyPair;
  receiver: string;
}): { envelope: string; keyId: string } {
  const keyId = syncKeyIdOf(input.syncKey);
  const nonce = randomBytes(NONCE_BYTES);
  const key = envelopeKey({
    privateKey: input.sender.privateKey,
    peer: input.receiver,
    sender: input.sender.publicKey,
    receiver: input.receiver,
  });
  const cipher = createCipheriv(AEAD, key, nonce);
  cipher.setAAD(envelopeData(keyId));
  const body = Buffer.concat([cipher.update(input.syncKey), cipher.final()]);
  const envelope = Buffer.concat([
    Buffer.from([FORMAT_VERSION]),
    Buffer.from(input.sender.publicKey, 'base64'),
    nonce,
    body,
    cipher.getAuthTag(),
  ]).toString('base64');
  return { envelope, keyId };
}

/** The sender's public key, read before anything is opened, so the fingerprint is shown first. */
export function envelopeSender(envelope: string): string | undefined {
  const sealed = Buffer.from(envelope, 'base64');
  if (sealed.length < 1 + PUBLIC_BYTES || sealed[0] !== FORMAT_VERSION) return undefined;
  return sealed.subarray(1, 1 + PUBLIC_BYTES).toString('base64');
}

/** The sync key, or undefined where the envelope was not sealed to this machine or names another key. */
export function openEnvelope(input: {
  envelope: string;
  keyId: string;
  receiver: ExchangeKeyPair;
}): Buffer | undefined {
  const sealed = Buffer.from(input.envelope, 'base64');
  const sender = envelopeSender(input.envelope);
  if (sender === undefined) return undefined;
  const nonceAt = 1 + PUBLIC_BYTES;
  const bodyAt = nonceAt + NONCE_BYTES;
  if (sealed.length !== bodyAt + SYNC_KEY_BYTES + TAG_BYTES) return undefined;
  try {
    const key = envelopeKey({
      privateKey: input.receiver.privateKey,
      peer: sender,
      sender,
      receiver: input.receiver.publicKey,
    });
    const decipher = createDecipheriv(AEAD, key, sealed.subarray(nonceAt, bodyAt));
    decipher.setAAD(envelopeData(input.keyId));
    decipher.setAuthTag(sealed.subarray(bodyAt + SYNC_KEY_BYTES));
    const syncKey = Buffer.concat([
      decipher.update(sealed.subarray(bodyAt, bodyAt + SYNC_KEY_BYTES)),
      decipher.final(),
    ]);
    return syncKeyIdOf(syncKey) === input.keyId ? syncKey : undefined;
  } catch {
    // Sealed to another key, or tampered with on the way: there is no key in it for this machine.
    return undefined;
  }
}
