import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { rulesOfPack, type RulePackView } from '@memnox/core';
import { PACKS_DIR } from './rule-pack-dir';

/**
 * The rule packs Memnox ships, read from beside the bundle or from the repository when running from
 * source. Each is offered whole; importing one raises a signed proposal per rule as any pack does.
 */

/** Where they live in the repository. */
const PACKS_SOURCE = join('assets', 'packs');

const PACK_SUFFIX = '.toml';

/** How far up from this chunk the shipped folder or the repository root can be. */
const MOST_LEVELS = 6;

/** Every shipped pack that loads, by file name; a pack that would not load is left out rather than offered. */
export async function shippedRulePacks(
  from: string = dirname(fileURLToPath(import.meta.url)),
): Promise<RulePackView[]> {
  const dir = packsDirFrom(from);
  if (dir === null) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(PACK_SUFFIX)).sort();
  const packs: RulePackView[] = [];
  for (const name of names) {
    const pack = packOf(
      name.slice(0, -PACK_SUFFIX.length),
      await readFile(join(dir, name), 'utf8'),
    );
    if (pack !== null) packs.push(pack);
  }
  return packs;
}

/** Walked upward because the bundler decides which chunk this lands in. */
function packsDirFrom(from: string): string | null {
  let dir = from;
  for (let up = 0; up < MOST_LEVELS; up += 1) {
    if (existsSync(join(dir, PACKS_DIR))) return join(dir, PACKS_DIR);
    if (existsSync(join(dir, PACKS_SOURCE))) return join(dir, PACKS_SOURCE);
    dir = dirname(dir);
  }
  return null;
}

function packOf(id: string, toml: string): RulePackView | null {
  const read = rulesOfPack(toml);
  if ('problems' in read) return null;
  const about = aboutOf(toml);
  return {
    id,
    name: about.name ?? id,
    description: about.description ?? '',
    ruleCount: read.rules.length,
    toml,
  };
}

/** The pack's own `[pack]` table, which the policy validator reads past. */
function aboutOf(toml: string): { name?: string; description?: string } {
  const pack = parseToml(toml)['pack'];
  if (typeof pack !== 'object' || pack === null || Array.isArray(pack)) return {};
  // Cast is safe: a plain table was checked just above, and each field is checked below.
  const { name, description } = pack as Record<string, unknown>;
  return {
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof description === 'string' ? { description } : {}),
  };
}
