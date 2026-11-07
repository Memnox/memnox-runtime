import { createHash } from 'node:crypto';
import type { HoldRequest } from './hold';

/**
 * The exact call a yes is bound to. Five fields in a fixed order, each written out even when empty,
 * so the daemon and every screen that checks it agree byte for byte.
 */

type ActionFields = Pick<
  HoldRequest,
  'operation' | 'target' | 'command' | 'fingerprint' | 'cwd' | 'agent'
>;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The call as the digest reads it; the arguments go in as a digest of their own, never as they are. */
export function canonicalAction(request: ActionFields): string {
  return JSON.stringify({
    operation: request.operation,
    target: request.target ?? '',
    argumentDigest: sha256(`${request.command ?? ''}\n${request.fingerprint}`),
    cwd: request.cwd ?? '',
    agent: request.agent,
  });
}

/** SHA-256 of the canonical call, in hex, which a v4 confirmation signs. */
export function actionDigestOf(request: ActionFields): string {
  return sha256(canonicalAction(request));
}
