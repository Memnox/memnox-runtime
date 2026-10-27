#!/bin/sh
# Builds the native wrapper for this machine into dist/<platform>-<arch>, where the CLI build picks it up.
set -eu
cd "$(dirname "$0")/.."
cargo test --release
cargo build --release
triple="$(node -p 'process.platform + "-" + process.arch')"
mkdir -p "dist/$triple"
cp target/release/memnox-intercept-native "dist/$triple/memnox-intercept-native"
chmod 755 "dist/$triple/memnox-intercept-native"
echo "built dist/$triple/memnox-intercept-native"
