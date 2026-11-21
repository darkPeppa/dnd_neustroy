#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NEUSTROY_ROOT="$(cd .. && pwd)"
if [ -z "${JAVA_HOME:-}" ] && [ -d "$NEUSTROY_ROOT/.local/mobile-toolchain/jdk" ]; then JAVA_HOME="$(find "$NEUSTROY_ROOT/.local/mobile-toolchain/jdk" -type d -path '*/Contents/Home' -print -quit)"; export JAVA_HOME; fi
if [ -n "${JAVA_HOME:-}" ]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$NEUSTROY_ROOT/.local/mobile-toolchain/android-sdk" ]; then export ANDROID_HOME="$NEUSTROY_ROOT/.local/mobile-toolchain/android-sdk"; fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$NEUSTROY_ROOT/.local/gradle}"
node ../scripts/prepare-mobile.mjs
if [ "$#" -eq 0 ]; then set -- :desktopApp:packageUberJarForCurrentOS; fi
./gradlew --no-daemon "$@"
