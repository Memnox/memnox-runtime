import { createRequire } from 'node:module';
import type * as Binding from '@memnox/noise';

/**
 * The one door to snow, through `@memnox/noise`, which the iPhone links as the same build. This
 * only picks the pattern and hands over keys; every handshake, cipher state and rekey is snow's.
 */

export type NoiseHandshake = Binding.Handshake;
export type NoiseTransport = Binding.Transport;

export const NOISE_PATTERN = {
  /** Every connection after pairing, the phone already knowing this machine's key. */
  IK: 'IK',
  /** Pairing, with the QR's one time secret as the pre shared key. */
  XXPSK0: 'XXpsk0',
} as const;

type NoisePattern = (typeof NOISE_PATTERN)[keyof typeof NOISE_PATTERN];

export interface Noise {
  generateKeypair(): { publicKey: Buffer; privateKey: Buffer };
  respond(pattern: NoisePattern, localPrivate: Buffer, psk?: Buffer): NoiseHandshake;
  initiate(
    pattern: NoisePattern,
    localPrivate: Buffer,
    remote?: { publicKey?: Buffer; psk?: Buffer },
  ): NoiseHandshake;
  pairingCode(handshakeHash: Buffer): string;
}

let loaded: Noise | null = null;

/** Loaded on first use, so a platform with no addon still runs every command that never pairs a phone. */
export function loadNoise(): Noise {
  if (loaded !== null) return loaded;
  // A native addon cannot be imported statically without breaking the CLI wherever it is missing.
  let binding: typeof Binding;
  try {
    binding = createRequire(import.meta.url)('@memnox/noise') as typeof Binding;
  } catch (error) {
    throw new Error(
      `Pairing needs the Noise addon, and this install has none for ${process.platform}-${process.arch}. Build it with pnpm --filter @memnox/noise build, which needs Rust.`,
      { cause: error },
    );
  }
  loaded = {
    generateKeypair: () => binding.generateKeypair(),
    respond: (pattern, localPrivate, psk) =>
      binding.Handshake.responder(pattern, localPrivate, psk),
    initiate: (pattern, localPrivate, remote) =>
      binding.Handshake.initiator(pattern, localPrivate, remote?.publicKey, remote?.psk),
    pairingCode: (hash) => binding.pairingCode(hash),
  };
  return loaded;
}
