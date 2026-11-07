import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  type ScryptOptions,
} from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * A backup sealed with a passphrase: AES-256-GCM under a key scrypt draws from it, so the archive
 * can sit anywhere and says nothing to whoever finds it. The header is bound in, so it cannot be swapped.
 */

export const BACKUP_FORMAT = 'memnox-backup';
export const BACKUP_VERSION = 1;

/** Long enough that a guess is work, short enough to type at a restore. */
export const SHORTEST_PASSPHRASE = 10;

const CIPHER = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KDF = { name: 'scrypt', N: 2 ** 15, r: 8, p: 1 } as const;
/** Above what N and r need, which is 128 times N times r bytes, so scrypt never refuses its own work. */
const KDF_MEMORY = 64 * 1024 * 1024;

/** One file, by its path under the Memnox home, in base64. */
export interface BackupEntry {
  path: string;
  data: string;
}

export interface BackupContents {
  createdAt: string;
  entries: BackupEntry[];
}

interface Envelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  kdf: { name: string; N: number; r: number; p: number; salt: string };
  cipher: typeof CIPHER;
  iv: string;
  tag: string;
  data: string;
}

function keyOf(
  passphrase: string,
  salt: Buffer,
  kdf: Omit<Envelope['kdf'], 'salt' | 'name'>,
): Promise<Buffer> {
  const options: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: KDF_MEMORY };
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), salt, KEY_BYTES, options, (err, key) =>
      err === null ? resolve(key) : reject(err),
    ),
  );
}

/** Everything but the ciphertext, which the tag also covers. */
function headerOf(envelope: Omit<Envelope, 'tag' | 'data'>): Buffer {
  return Buffer.from(
    JSON.stringify([
      envelope.format,
      envelope.version,
      envelope.kdf,
      envelope.cipher,
      envelope.iv,
    ]),
  );
}

/** The contents sealed under the passphrase, as text a screen saves as a file. */
export async function sealBackup(
  contents: BackupContents,
  passphrase: string,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await keyOf(passphrase, salt, KDF);
  const head = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: { ...KDF, salt: salt.toString('base64') },
    cipher: CIPHER,
    iv: iv.toString('base64'),
  } as const;
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(headerOf(head));
  const data = Buffer.concat([
    cipher.update(gzipSync(JSON.stringify(contents))),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    ...head,
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/** The contents, or why the archive will not open: not one of ours, the wrong passphrase, or changed. */
export async function openBackup(
  archive: string,
  passphrase: string,
): Promise<BackupContents | { refused: string }> {
  const envelope = envelopeOf(archive);
  if (envelope === null) return { refused: 'That is not a Memnox backup.' };
  try {
    const key = await keyOf(
      passphrase,
      Buffer.from(envelope.kdf.salt, 'base64'),
      envelope.kdf,
    );
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(headerOf(envelope));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    const contents = contentsOf(JSON.parse(gunzipSync(plain).toString('utf8')));
    return (
      contents ?? { refused: 'The backup opened, but what it holds is not a backup.' }
    );
  } catch {
    // GCM cannot tell a wrong passphrase from a changed archive, and neither is restored.
    return {
      refused: 'The passphrase is wrong, or the backup was changed since it was made.',
    };
  }
}

function envelopeOf(archive: string): Envelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(archive);
  } catch {
    // Not JSON is not an archive of ours, which the caller says in words.
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  // Cast is safe: each field is checked below before it is used.
  const value = raw as Record<string, unknown>;
  const kdf = value['kdf'];
  if (value['format'] !== BACKUP_FORMAT || value['version'] !== BACKUP_VERSION)
    return null;
  if (value['cipher'] !== CIPHER || typeof kdf !== 'object' || kdf === null) return null;
  // Cast is safe: its fields are checked in the same expression.
  const k = kdf as Record<string, unknown>;
  const numbers = [k['N'], k['r'], k['p']].every((each) => typeof each === 'number');
  const texts = [k['salt'], value['iv'], value['tag'], value['data']].every(
    (each) => typeof each === 'string',
  );
  // An attacker's cost parameters could stall the daemon, so only ours are taken.
  if (!numbers || !texts || k['N'] !== KDF.N || k['r'] !== KDF.r || k['p'] !== KDF.p)
    return null;
  // Cast is safe: every field was checked just above.
  return raw as Envelope;
}

function contentsOf(raw: unknown): BackupContents | null {
  if (typeof raw !== 'object' || raw === null) return null;
  // Cast is safe: each field is checked below before it is kept.
  const value = raw as Record<string, unknown>;
  const entries = value['entries'];
  if (typeof value['createdAt'] !== 'string' || !Array.isArray(entries)) return null;
  const kept: BackupEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) return null;
    // Cast is safe: both fields are checked before either is kept.
    const { path, data } = entry as Record<string, unknown>;
    if (typeof path !== 'string' || typeof data !== 'string') return null;
    kept.push({ path, data });
  }
  return { createdAt: value['createdAt'], entries: kept };
}

/** A path under the Memnox home a backup may hold: one of the named files, or a file inside a named folder. */
export function isBackupPath(
  path: string,
  allowed: { files: readonly string[]; dirs: readonly string[] },
): boolean {
  if (path.includes('\\') || path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  if (parts.length === 1) return allowed.files.includes(path);
  return allowed.dirs.includes(parts[0] ?? '');
}
