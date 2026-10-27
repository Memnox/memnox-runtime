'use strict';

const { join } = require('node:path');

// A local build beside this file wins, so a developer's own build is what runs; otherwise the
// prebuilt package for this platform, which npm installed as an optional dependency.
const platform = `${process.platform}-${process.arch}`;
// Linux builds name their libc and Windows builds their toolchain, as npm's native packages do.
const prebuilt =
  process.platform === 'linux'
    ? `${platform}-gnu`
    : process.platform === 'win32'
      ? `${platform}-msvc`
      : platform;

function load() {
  try {
    return require(join(__dirname, `memnox-noise.${platform}.node`));
  } catch {
    // No local build, so the prebuilt one is tried next.
  }
  try {
    return require(`@memnox/noise-${prebuilt}`);
  } catch (error) {
    throw new Error(
      `@memnox/noise has no addon for ${platform}. Reinstall memnox so npm fetches @memnox/noise-${prebuilt}, or build it with pnpm --filter @memnox/noise build, which needs Rust.`,
      { cause: error },
    );
  }
}

const binding = load();

module.exports.generateKeypair = binding.generateKeypair;
module.exports.Handshake = binding.Handshake;
module.exports.Transport = binding.Transport;
module.exports.pairingCode = binding.pairingCode;
