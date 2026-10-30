import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/canonical-json';

/**
 * What one person carries across their own machines, item by item: each a kind and a name, and
 * a body that is the item as this machine keeps it. Only the body's ciphertext leaves; the name
 * becomes an HMAC under the sync key, and the cloud sees neither.
 */

/** The kinds Memnox Cloud keeps, each its own namespace of items. */
export const SYNC_KIND = {
  /** MCP Hub servers by name and launch line; a secret travels as its name only. */
  SERVERS: 'servers',
  /** Personal skills, manifest and files, at the version accepted. */
  SKILLS: 'skills',
  /** Projects opened, by repository; a path names one laptop, so none travels. */
  PROJECTS: 'projects',
  /** Rules the person set in this machine's own rule file. */
  RULES: 'rules',
  /** Personal memory facts the person verified, never a candidate and never a project's. */
  MEMORY: 'memory',
} as const;

export type SyncKind = (typeof SYNC_KIND)[keyof typeof SYNC_KIND];

export const SYNC_KINDS: readonly string[] = Object.values(SYNC_KIND);

/** One item's ciphertext as Memnox Cloud bounds it, in base64 characters. */
export const MOST_SYNC_ITEM_CHARS = 96 * 1024;
/** Items one upload carries. */
export const MOST_SYNC_UPLOAD = 50;

/** One item as this machine reads it: what it is, its name, and its body. */
export interface SyncItem {
  kind: SyncKind;
  name: string;
  body: unknown;
}

/** What is sealed: the item whole, so the receiving machine learns its name only on opening it. */
export function syncPlaintextOf(item: SyncItem): string {
  return canonicalJson(item);
}

/** The item a sealed text holds, or undefined where it is not one. */
export function syncItemOf(text: string): SyncItem | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A sealed text that is not JSON was written by nothing of ours, so nothing is read from it.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  // Cast is safe: each field is checked on the next lines.
  const raw = parsed as Record<string, unknown>;
  const { kind, name } = raw;
  if (typeof kind !== 'string' || !SYNC_KINDS.includes(kind)) return undefined;
  if (typeof name !== 'string' || name === '') return undefined;
  // Cast is safe: checked against the kinds above.
  return { kind: kind as SyncKind, name, body: raw['body'] };
}

/** What an item was when last synced, so only one that changed is sealed and sent again. */
export function syncDigestOf(item: SyncItem): string {
  return createHash('sha256').update(syncPlaintextOf(item), 'utf8').digest('hex');
}
