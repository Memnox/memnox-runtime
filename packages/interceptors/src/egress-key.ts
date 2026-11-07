import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

import { JsonRecordDir, MEMNOX_HOME } from '@memnox/core';

import type { EgressCaller } from './egress-seam';

/**
 * A secret a session's proxy URL carries beside its id, so the session's folder and project
 * decide a request only from a client handed that session's environment, never one naming its id.
 */

export const EGRESS_KEYS_DIR = 'egress-keys';

/** Enough random bytes that guessing a key is not something a local process can do. */
const KEY_BYTES = 32;

const HASH_ALGORITHM = 'sha256';

/** What a key looks like on the wire, so an agent name is never mistaken for one. */
const KEY_SHAPE = /^[0-9a-f]{64}$/;

interface EgressKeyRecord {
  sessionId: string;
  keyHash: string;
}

/** A fresh key for one session's proxy URL. */
export function newEgressKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

/** Whether a credential segment is shaped like a key this module issued. */
export function isEgressKey(value: string): boolean {
  return KEY_SHAPE.test(value);
}

function hashOf(key: string): Buffer {
  return createHash(HASH_ALGORITHM).update(key, 'utf8').digest();
}

/** The keys issued on this machine, kept as hashes so reading the home hands nobody a key. */
export class EgressKeys {
  private readonly records: JsonRecordDir<EgressKeyRecord>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, EGRESS_KEYS_DIR));
  }

  issue(sessionId: string, key: string): Promise<void> {
    return this.records.write(fileFor(sessionId), {
      sessionId,
      keyHash: hashOf(key).toString('hex'),
    });
  }

  /** True only for the key issued to the session the caller names; anything else is a stranger. */
  async vouches(caller: EgressCaller): Promise<boolean> {
    const { sessionId, key } = caller;
    if (sessionId === undefined || key === undefined || !isEgressKey(key)) return false;
    // An unreadable record vouches for nobody, the same as one never issued.
    const record = await this.records.read(fileFor(sessionId)).catch(() => null);
    if (record === null || record.sessionId !== sessionId) return false;
    const kept = Buffer.from(record.keyHash, 'hex');
    const offered = hashOf(key);
    return kept.length === offered.length && timingSafeEqual(kept, offered);
  }

  forget(sessionId: string): Promise<void> {
    return this.records.remove(fileFor(sessionId));
  }
}

/** A session id as a file name; the record keeps the id itself, so two that share a name never pass for each other. */
function fileFor(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}
