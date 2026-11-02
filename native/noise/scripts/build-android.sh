#!/bin/sh
# Builds the JNI binding for Android phones and the emulator, laid out as the jniLibs folder the app copies in.
set -eu
cd "$(dirname "$0")/.."
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-}}"
if [ -z "$ndk" ]; then
  echo "set ANDROID_NDK_HOME to an Android NDK, which Android Studio installs under its SDK" >&2
  exit 1
fi
# Android 11 is the floor because the Keystore's per use biometric key, which signs every yes, starts there.
api="${MEMNOX_ANDROID_API:-30}"
# The NDK's Windows compilers are .cmd wrappers and its archiver an .exe, which Git Bash runs as they are.
clang_suffix=""
ar_suffix=""
case "$(uname -s)" in
  Darwin) host="darwin-x86_64" ;;
  Linux) host="linux-x86_64" ;;
  MINGW* | MSYS* | CYGWIN*) host="windows-x86_64"; clang_suffix=".cmd"; ar_suffix=".exe" ;;
  *) echo "the NDK build runs on macOS, Linux or Git Bash on Windows, not $(uname -s)" >&2; exit 1 ;;
esac
bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
out="build/android/jniLibs"

build() {
  triple="$1"
  abi="$2"
  rustup target add "$triple" >/dev/null
  linker_var="CARGO_TARGET_$(printf '%s' "$triple" | tr 'a-z-' 'A-Z_')_LINKER"
  # ring, which snow uses, compiles C as well, so the cc crate is named the NDK's compiler and archiver too.
  cc_var="CC_$(printf '%s' "$triple" | tr '-' '_')"
  ar_var="AR_$(printf '%s' "$triple" | tr '-' '_')"
  clang="$bin/$triple$api-clang$clang_suffix"
  env "$linker_var=$clang" "$cc_var=$clang" "$ar_var=$bin/llvm-ar$ar_suffix" \
    cargo build --release --features jni --target "$triple"
  mkdir -p "$out/$abi"
  cp "target/$triple/release/libmemnox_noise.so" "$out/$abi/libmemnox_noise.so"
  echo "built $out/$abi/libmemnox_noise.so"
}

build aarch64-linux-android arm64-v8a
build x86_64-linux-android x86_64
