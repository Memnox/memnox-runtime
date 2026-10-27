#!/bin/sh
# Builds the C ABI as static libraries for the iPhone, its simulator and the Mac, and wraps them for Swift.
set -eu
cd "$(dirname "$0")/.."
targets="aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin"
rustup target add $targets
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
for t in $targets; do
  cargo build --release --no-default-features --features ffi --lib --target "$t"
done
out="build/MemnoxNoise.xcframework"
headers="build/headers"
rm -rf "$out" "$headers"
mkdir -p "$headers"
cp include/memnox_noise.h include/module.modulemap "$headers/"
args=""
for t in $targets; do
  args="$args -library target/$t/release/libmemnox_noise.a -headers $headers"
done
xcodebuild -create-xcframework $args -output "$out"
echo "built $out"
