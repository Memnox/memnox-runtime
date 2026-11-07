/**
 * A secret as an agent's config holds it: a name, never the value. The proxy swaps the name
 * for the value from the OS store just before it starts the server, so neither the config
 * file nor the agent's own environment ever carries the credential.
 */

export const SECRET_REF_PREFIX = 'memnox-secret:';

/** Short and plain, since it becomes a keychain account name on every platform. */
const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isKeptSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function secretRef(name: string): string {
  return `${SECRET_REF_PREFIX}${name}`;
}

/** The secret a value names, or undefined for an ordinary value. */
export function secretNameOf(value: string): string | undefined {
  if (!value.startsWith(SECRET_REF_PREFIX)) return undefined;
  const name = value.slice(SECRET_REF_PREFIX.length);
  return isKeptSecretName(name) ? name : undefined;
}

/** Looks a secret up in the OS store; undefined when it is not held. */
export type SecretLookup = (name: string) => Promise<string | undefined>;

export interface ResolvedEnv {
  env: Record<string, string>;
  /** Variables whose secret is not held, so the caller can say which and refuse to start. */
  missing: { variable: string; secret: string }[];
}

/** Every reference swapped for its value; a missing one is left out and named, never passed on as the reference. */
export async function resolveSecretRefs(
  env: Readonly<Record<string, string | undefined>>,
  lookup: SecretLookup,
): Promise<ResolvedEnv> {
  const resolved: Record<string, string> = {};
  const missing: ResolvedEnv['missing'] = [];
  for (const [variable, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const secret = secretNameOf(value);
    if (secret === undefined) {
      resolved[variable] = value;
      continue;
    }
    const held = await lookup(secret);
    if (held === undefined) missing.push({ variable, secret });
    else resolved[variable] = held;
  }
  return { env: resolved, missing };
}

/** A reference anywhere in a value, so a header can read `Bearer memnox-secret:github`. */
const EMBEDDED_REF = /memnox-secret:([A-Za-z0-9][A-Za-z0-9._-]{0,63})/g;

/** Every secret a value names, wherever in the value it sits. */
export function secretNamesIn(value: string): string[] {
  return [...value.matchAll(EMBEDDED_REF)].map((match) => match[1] ?? '');
}

export interface ResolvedHeaders {
  headers: Record<string, string>;
  /** Headers whose secret is not held, so the caller can say which and refuse to start. */
  missing: { header: string; secret: string }[];
}

/** Each reference inside each header value swapped for the secret it names; a missing one is named, never sent. */
export async function resolveHeaderRefs(
  headers: Readonly<Record<string, string>>,
  lookup: SecretLookup,
): Promise<ResolvedHeaders> {
  const resolved: Record<string, string> = {};
  const missing: ResolvedHeaders['missing'] = [];
  for (const [header, value] of Object.entries(headers)) {
    const held = new Map<string, string>();
    for (const secret of new Set(secretNamesIn(value))) {
      const found = await lookup(secret);
      if (found === undefined) missing.push({ header, secret });
      else held.set(secret, found);
    }
    resolved[header] = value.replace(
      EMBEDDED_REF,
      (ref, secret: string) => held.get(secret) ?? ref,
    );
  }
  return { headers: resolved, missing };
}
