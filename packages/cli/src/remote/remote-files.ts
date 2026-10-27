import { chmod } from 'node:fs/promises';
import { readJsonFile, writeJsonFile } from '@memnox/core';
import { kokoroVoicePath, noiseKeyPath } from '../memnox-paths';
import type { Noise } from './noise';

/**
 * The two small files the remote endpoint keeps: this machine's Noise static key, made once and
 * never sent anywhere but inside a handshake, and the Kokoro voice the person picked on the Mac.
 */

/** The voice the Mac and a paired phone start with, until the person picks another. */
const DEFAULT_VOICE = 'af_heart';

/** A Kokoro voice id: a language and gender pair, an underscore, then a name. */
const VOICE_ID = /^[a-z]{2}_[a-z0-9]{1,32}$/;

const OWNER_ONLY = 0o600;

interface StoredKey {
  publicKey: string;
  privateKey: string;
}

export interface NoiseKeypair {
  publicKey: Buffer;
  privateKey: Buffer;
}

/** The machine's key, made on first use; anyone who reads it can be this machine to a phone, so it is owner only. */
export async function runtimeNoiseKey(home: string, noise: Noise): Promise<NoiseKeypair> {
  const path = noiseKeyPath(home);
  const stored = await readJsonFile<StoredKey>(path);
  if (typeof stored?.publicKey === 'string' && typeof stored.privateKey === 'string') {
    return {
      publicKey: Buffer.from(stored.publicKey, 'base64'),
      privateKey: Buffer.from(stored.privateKey, 'base64'),
    };
  }
  const made = noise.generateKeypair();
  await writeJsonFile(path, {
    publicKey: made.publicKey.toString('base64'),
    privateKey: made.privateKey.toString('base64'),
  });
  await chmod(path, OWNER_ONLY);
  return made;
}

export async function readVoice(home: string): Promise<string> {
  const stored = await readJsonFile<{ voice?: unknown }>(kokoroVoicePath(home));
  return typeof stored?.voice === 'string' && VOICE_ID.test(stored.voice)
    ? stored.voice
    : DEFAULT_VOICE;
}

/** False for anything that is not a voice id, which is left unset rather than kept. */
export async function keepVoice(
  home: string,
  voice: string,
  at: string,
): Promise<boolean> {
  if (!VOICE_ID.test(voice)) return false;
  await writeJsonFile(kokoroVoicePath(home), { voice, at });
  return true;
}
