#!/bin/sh
# Builds the JNI binding for this machine and runs the Java round trip against it, the check Android relies on.
set -eu
cd "$(dirname "$0")/.."
cargo build --features jni
out="target/jni-test"
rm -rf "$out"
mkdir -p "$out"
javac -d "$out" test/jni/com/memnox/noise/MemnoxNoise.java test/jni/JniRoundTrip.java
java --enable-native-access=ALL-UNNAMED -Djava.library.path=target/debug -cp "$out" JniRoundTrip
