import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  envelopeSender,
  newExchangeKeyPair,
  newSyncKey,
  openEnvelope,
  openSyncItem,
  pairFingerprint,
  PROPOSAL_KIND,
  proposalCapability,
  remoteCapabilityFor,
  REMOTE_CAPABILITY,
  sealEnvelope,
  sealSyncItem,
  exchangePublicOf,
  syncDigestOf,
  syncItemIdOf,
  syncItemOf,
  syncKeyIdOf,
  syncPlaintextOf,
} from '../src/index';

/**
 * Personal sync's cryptography: the cloud is handed ids it cannot read a name from and ciphertext
 * bound to its kind and id, and the key moves only in an envelope whose fingerprint both machines show.
 */

describe('items under the sync key', () => {
  const key = newSyncKey();

  it('names an item by an HMAC the cloud accepts and no other key repeats', () => {
    const id = syncItemIdOf(key, 'servers', 'linear');
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(syncItemIdOf(key, 'servers', 'linear')).toBe(id);
    expect(syncItemIdOf(key, 'skills', 'linear')).not.toBe(id);
    expect(syncItemIdOf(newSyncKey(), 'servers', 'linear')).not.toBe(id);
  });

  it('names the key by an id derived from it', () => {
    expect(syncKeyIdOf(key)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(syncKeyIdOf(key)).toBe(syncKeyIdOf(Buffer.from(key)));
  });

  it('opens what it sealed, and nothing moved to another kind or id', () => {
    const id = syncItemIdOf(key, 'rules', 'no-force-push');
    const text = syncPlaintextOf({
      kind: 'rules',
      name: 'no-force-push',
      body: { a: 1 },
    });
    const ciphertext = sealSyncItem(key, { kind: 'rules', id, plaintext: text });
    expect(ciphertext).not.toContain('no-force-push');
    expect(openSyncItem(key, { kind: 'rules', id, ciphertext })).toBe(text);
    expect(openSyncItem(key, { kind: 'memory', id, ciphertext })).toBeUndefined();
    expect(
      openSyncItem(key, { kind: 'rules', id: `${id}x`, ciphertext }),
    ).toBeUndefined();
    expect(openSyncItem(newSyncKey(), { kind: 'rules', id, ciphertext })).toBeUndefined();
  });

  it('reads back only an item of a known kind, and digests it the same everywhere', () => {
    const item = { kind: 'servers' as const, name: 'linear', body: { b: 2, a: 1 } };
    expect(syncItemOf(syncPlaintextOf(item))).toEqual(item);
    expect(syncItemOf('{"kind":"secrets","name":"x"}')).toBeUndefined();
    expect(syncDigestOf(item)).toBe(
      syncDigestOf({ kind: 'servers', name: 'linear', body: { a: 1, b: 2 } }),
    );
  });
});

describe('the key carried to a new machine', () => {
  it('opens on the machine it was sealed to, with the fingerprint both show', () => {
    const syncKey = newSyncKey();
    const old = newExchangeKeyPair();
    const fresh = newExchangeKeyPair();
    const { envelope, keyId } = sealEnvelope({
      syncKey,
      sender: old,
      receiver: fresh.publicKey,
    });
    expect(envelope.length).toBeLessThanOrEqual(512);
    expect(keyId).toBe(syncKeyIdOf(syncKey));
    const sender = envelopeSender(envelope);
    expect(sender).toBe(old.publicKey);
    expect(pairFingerprint(fresh.publicKey, sender ?? '')).toBe(
      pairFingerprint(old.publicKey, fresh.publicKey),
    );
    expect(pairFingerprint(old.publicKey, fresh.publicKey)).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(openEnvelope({ envelope, keyId, receiver: fresh })?.equals(syncKey)).toBe(
      true,
    );
  });

  it('opens on no other machine, and not under another key id', () => {
    const syncKey = newSyncKey();
    const old = newExchangeKeyPair();
    const fresh = newExchangeKeyPair();
    const { envelope, keyId } = sealEnvelope({
      syncKey,
      sender: old,
      receiver: fresh.publicKey,
    });
    expect(
      openEnvelope({ envelope, keyId, receiver: newExchangeKeyPair() }),
    ).toBeUndefined();
    expect(
      openEnvelope({ envelope, keyId: 'another-key-id', receiver: fresh }),
    ).toBeUndefined();
  });

  it('keeps only the private half, which gives back the public one', () => {
    const pair = newExchangeKeyPair();
    expect(Buffer.from(pair.publicKey, 'base64')).toHaveLength(32);
    expect(exchangePublicOf(pair.privateKey)).toBe(pair.publicKey);
  });
});

describe('who may drive personal sync', () => {
  it('reads and syncs from a phone, and never moves the key from one', () => {
    expect(remoteCapabilityFor(DAEMON_METHOD.PERSONAL_SYNC_STATUS)).toBe(
      REMOTE_CAPABILITY.SEE,
    );
    expect(remoteCapabilityFor(DAEMON_METHOD.PERSONAL_SYNC_NOW)).toBe(
      REMOTE_CAPABILITY.ASK,
    );
    expect(remoteCapabilityFor(DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER)).toBeNull();
    expect(remoteCapabilityFor(DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT)).toBeNull();
    expect(
      proposalCapability({ kind: PROPOSAL_KIND.PERSONAL_SYNC_KEY, fingerprint: '1' }),
    ).toBeNull();
  });
});
