import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import type { SecretStore } from './node-secret-store';
import { renewSignIn, signInExpiring, type RemoteSignIn } from './remote-sign-in';

/**
 * Where a sign in Memnox made is kept, and how one proxy holds it while it runs: sealed under the
 * Memnox home with a key only the OS store holds, read again only when the token runs out or is refused.
 */

type Fetch = typeof fetch;

const SIGN_IN_SECRET_PREFIX = 'mcp-signin.';

/** The sealed sign in as it sits in its file: what AES-GCM needs to open it, and nothing readable. */
interface SealedSignIn {
  iv: string;
  tag: string;
  data: string;
}

const SIGN_IN_DIR = 'sign-ins';
const CIPHER = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * Sign ins filed by the server's address, so a renamed server keeps its own. Each is sealed in a file
 * under the Memnox home with a key only the OS store holds, because a token can be longer than some
 * OS stores take in one value, and a write that fails there would lose a sign in the person just made.
 */
export class RemoteSignIns {
  constructor(
    private readonly secrets: SecretStore,
    private readonly home: string,
  ) {}

  async get(url: string): Promise<RemoteSignIn | null> {
    const key = await this.keyOf(url);
    if (key === null) return null;
    const sealed = await readJsonFile<SealedSignIn>(this.pathOf(url));
    if (sealed === null) return null;
    try {
      const decipher = createDecipheriv(CIPHER, key, Buffer.from(sealed.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(sealed.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      // Cast is safe: sealed by `set` below, and the one field every use needs is checked.
      const signIn = JSON.parse(plain) as Partial<RemoteSignIn> | null;
      return typeof signIn?.accessToken === 'string' && signIn.url === url
        ? (signIn as RemoteSignIn)
        : null;
    } catch {
      // A file another key sealed, or one torn mid write, reads as no sign in, and the person signs in again.
      return null;
    }
  }

  async set(signIn: RemoteSignIn): Promise<void> {
    const key = (await this.keyOf(signIn.url)) ?? (await this.newKey(signIn.url));
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(signIn), 'utf8'),
      cipher.final(),
    ]);
    const sealed: SealedSignIn = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    await writeJsonFile(this.pathOf(signIn.url), sealed);
  }

  async remove(url: string): Promise<void> {
    await rm(this.pathOf(url), { force: true });
    await this.secrets.remove(nameFor(url));
  }

  private async keyOf(url: string): Promise<Buffer | null> {
    const kept = await this.secrets.get(nameFor(url)).catch(() => undefined);
    if (kept === undefined) return null;
    const key = Buffer.from(kept, 'base64');
    return key.length === KEY_BYTES ? key : null;
  }

  private async newKey(url: string): Promise<Buffer> {
    const key = randomBytes(KEY_BYTES);
    await this.secrets.set(nameFor(url), key.toString('base64'));
    return key;
  }

  private pathOf(url: string): string {
    return join(this.home, MEMNOX_HOME, SIGN_IN_DIR, `${shortDigest(url)}.json`);
  }
}

function nameFor(url: string): string {
  return `${SIGN_IN_SECRET_PREFIX}${shortDigest(url)}`;
}

/**
 * The kept sign in as one proxy uses it: the token in memory, read from the store again only when
 * it runs out or is refused, since every read of the OS store starts a process.
 */
export class KeptSignIn {
  private held: RemoteSignIn | null | undefined;

  constructor(
    private readonly signIns: RemoteSignIns,
    private readonly url: string,
    private readonly fetcher: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The token to send, renewed first where it is about to run out; undefined with no sign in kept. */
  async token(): Promise<string | undefined> {
    if (this.held === undefined) this.held = await this.signIns.get(this.url);
    const held = this.held;
    if (held === null) return undefined;
    if (!signInExpiring(held, this.now())) return held.accessToken;
    return (await this.renew(held.accessToken)) ?? held.accessToken;
  }

  /** A token other than the one just refused, or undefined where the person has to sign in again. */
  async renew(refused: string): Promise<string | undefined> {
    const kept = await this.signIns.get(this.url);
    if (kept === null) return undefined;
    // Another proxy for the same server renewed it first, and its token is the one that stands.
    if (kept.accessToken !== refused) return this.keep(kept);
    const fresh = await renewSignIn(kept, this.fetcher, this.now());
    if (fresh !== null) {
      await this.signIns.set(fresh);
      return this.keep(fresh);
    }
    // Two proxies renewing at once leave one refused, whose answer is whatever the other kept.
    const after = await this.signIns.get(this.url);
    return after !== null && after.accessToken !== refused ? this.keep(after) : undefined;
  }

  private keep(signIn: RemoteSignIn): string {
    this.held = signIn;
    return signIn.accessToken;
  }
}
