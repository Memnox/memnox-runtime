import { join } from 'node:path';
import { MEMNOX_HOME, readJsonFile, writeJsonFile } from '@memnox/core';

/**
 * The name the person asked the voice to call them, told to the daemon by the Mac app, so
 * the brain can speak to them by name. A name and nothing else, and it stays on this Mac.
 */

const OWNER_FILE = join('voice', 'owner.json');

interface Owner {
  name?: string;
  /** How the voice addresses them, such as "sir" or their name, chosen by them and never guessed. */
  address?: string;
}

/** Long enough for any first name, short enough that nothing else rides in with it. */
const NAME_LIMIT = 40;

export async function readOwner(home: string): Promise<string | undefined> {
  const kept = await readJsonFile<Owner>(join(home, MEMNOX_HOME, OWNER_FILE));
  return typeof kept?.name === 'string' && kept.name.trim() !== ''
    ? kept.name.trim()
    : undefined;
}

/** Only a plain name is kept, since it is written into the brain's own instructions. */
export async function keepOwner(home: string, name: string): Promise<void> {
  const plain = name
    .replace(/[^\p{L}\p{M}' -]/gu, '')
    .trim()
    .slice(0, NAME_LIMIT);
  if (plain === '' || plain === (await readOwner(home))) return;
  await writeOwner(home, { name: plain });
}

/** How they asked to be addressed, or undefined, which means no honorific at all. */
export async function readAddress(home: string): Promise<string | undefined> {
  const kept = await readJsonFile<Owner>(join(home, MEMNOX_HOME, OWNER_FILE));
  return typeof kept?.address === 'string' && kept.address.trim() !== ''
    ? kept.address.trim()
    : undefined;
}

/** Kept as plain words for the same reason as the name; null takes it away. */
export async function keepAddress(
  home: string,
  address: string | null,
): Promise<string | null> {
  const plain =
    address === null
      ? ''
      : address
          .replace(/[^\p{L}\p{M}' -]/gu, '')
          .trim()
          .slice(0, NAME_LIMIT);
  await writeOwner(home, plain === '' ? { address: undefined } : { address: plain });
  return plain === '' ? null : plain;
}

/** Merged into what is kept, so setting one never drops the other. */
async function writeOwner(home: string, change: Owner): Promise<void> {
  const path = join(home, MEMNOX_HOME, OWNER_FILE);
  const kept = (await readJsonFile<Owner>(path)) ?? {};
  const next: Owner = { ...kept, ...change };
  if (next.address === undefined) delete next.address;
  await writeJsonFile(path, next);
}

/** What a brief may open with: the address they chose, else their name, which a held call earns. */
export async function howToAddress(home: string): Promise<string | undefined> {
  return (await readAddress(home)) ?? (await readOwner(home));
}
