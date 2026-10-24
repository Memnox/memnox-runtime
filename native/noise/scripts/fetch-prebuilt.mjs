/**
 * Puts the published Noise addon for this machine beside index.js, so a checkout with no Rust
 * can run the pairing tests.
 *
 * pnpm links each `@memnox/noise-<platform>` to its folder under `npm/`, which is empty until a
 * release fills it, so on Linux and Windows a fresh checkout loaded nothing and forty tests
 * failed for want of a toolchain. The same prebuilt npm hands a user is fetched here, checked
 * against the integrity the registry signed off, and written where the loader looks first.
 *
 * It never fails an install: offline, behind a proxy, or on a platform nothing is published for,
 * it says how to build the addon and leaves the rest of the install alone.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const NOISE_DIR = join(import.meta.dirname, '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const TAR_BLOCK = 512;
const TAR_NAME = { at: 0, length: 100 };
const TAR_SIZE = { at: 124, length: 12 };
const TAR_PREFIX = { at: 345, length: 155 };
const OCTAL = 8;
const BUILD_HINT = 'Build it with pnpm --filter @memnox/noise build, which needs Rust.';

const platform = `${process.platform}-${process.arch}`;
// Named the way index.js names it, since that is the package it falls back to.
const prebuilt =
  process.platform === 'linux'
    ? `${platform}-gnu`
    : process.platform === 'win32'
      ? `${platform}-msvc`
      : platform;
const target = join(NOISE_DIR, `memnox-noise.${platform}.node`);

function say(line) {
  console.error(`@memnox/noise: ${line}`);
}

/** Whether this checkout can already load an addon, from a local build or a filled `npm/` folder. */
function alreadyLoadable() {
  if (existsSync(target)) return true;
  return existsSync(join(NOISE_DIR, 'npm', prebuilt, `memnox-noise.${prebuilt}.node`));
}

function field(header, { at, length }) {
  return header
    .subarray(at, at + length)
    .toString('utf8')
    .replace(/\0.*$/s, '');
}

/** The one file wanted out of a tarball, read by hand because the repo takes no tar dependency. */
function fileFromTar(tar, wanted) {
  for (let offset = 0; offset + TAR_BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    const name = field(header, TAR_NAME);
    if (name === '') return null;
    const prefix = field(header, TAR_PREFIX);
    const size = Number.parseInt(field(header, TAR_SIZE).trim() || '0', OCTAL);
    const body = offset + TAR_BLOCK;
    if ((prefix === '' ? name : `${prefix}/${name}`) === wanted) {
      return tar.subarray(body, body + size);
    }
    offset = body + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return null;
}

async function fetchPrebuilt() {
  const { version } = JSON.parse(await readFile(join(NOISE_DIR, 'package.json'), 'utf8'));
  const registry = (process.env.npm_config_registry ?? DEFAULT_REGISTRY).replace(
    /\/$/,
    '',
  );
  const name = `@memnox/noise-${prebuilt}`;
  const meta = await fetch(`${registry}/${name.replace('/', '%2f')}/${version}`);
  if (!meta.ok) {
    say(`no ${name}@${version} on ${registry} (${meta.status}). ${BUILD_HINT}`);
    return;
  }
  const { dist } = await meta.json();
  const tarball = Buffer.from(await (await fetch(dist.tarball)).arrayBuffer());
  const [algorithm, expected] = String(dist.integrity).split('-');
  // The registry's own hash, so a tarball altered on the way is refused rather than loaded.
  const actual = createHash(algorithm).update(tarball).digest('base64');
  if (actual !== expected) {
    say(
      `${name}@${version} did not match the registry's integrity, so it was not used. ${BUILD_HINT}`,
    );
    return;
  }
  const addon = fileFromTar(gunzipSync(tarball), `package/memnox-noise.${prebuilt}.node`);
  if (addon === null) {
    say(`${name}@${version} holds no addon. ${BUILD_HINT}`);
    return;
  }
  await writeFile(target, addon);
  say(`fetched the published ${name}@${version}. A local build replaces it.`);
}

// CI builds the addon from source, which is what its tests are meant to prove.
if (process.env.CI === undefined && !alreadyLoadable()) {
  await fetchPrebuilt().catch((error) => {
    say(`could not fetch a prebuilt addon (${error.message}). ${BUILD_HINT}`);
  });
}
