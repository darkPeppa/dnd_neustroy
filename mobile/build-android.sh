#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NEUSTROY_ROOT="$(cd .. && pwd)"
NEUSTROY_TOOLS="$NEUSTROY_ROOT/.local/mobile-toolchain"
if [ -z "${JAVA_HOME:-}" ] && [ -d "$NEUSTROY_TOOLS/jdk" ]; then
  JAVA_HOME="$(find "$NEUSTROY_TOOLS/jdk" -type d -path '*/Contents/Home' -print -quit)"; export JAVA_HOME
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$NEUSTROY_TOOLS/android-sdk" ]; then export ANDROID_HOME="$NEUSTROY_TOOLS/android-sdk"; fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_SDK_ROOT:-}" ]; then export ANDROID_HOME="$ANDROID_SDK_ROOT"; fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then export ANDROID_HOME="$HOME/Library/Android/sdk"; fi
if [ -z "${ANDROID_HOME:-}" ]; then echo 'Установите Android SDK в Android Studio и укажите ANDROID_HOME.' >&2; exit 1; fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$NEUSTROY_ROOT/.local/gradle}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$NEUSTROY_ROOT/.local/android}"
if [ -n "${JAVA_HOME:-}" ]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
node "$NEUSTROY_ROOT/scripts/prepare-mobile.mjs"
if [ ! -f "$NEUSTROY_ROOT/.local/android-debug.keystore" ]; then
  mkdir -p "$NEUSTROY_ROOT/.local"
  keytool -genkeypair -keystore "$NEUSTROY_ROOT/.local/android-debug.keystore" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=neustroy development,O=neustroy,C=RU' >/dev/null 2>&1
fi
if [ "$#" -eq 0 ]; then set -- :shared:testDebugUnitTest :androidApp:assembleDebug :androidApp:lintDebug; fi
./gradlew --no-daemon "$@"
if [ -f androidApp/build/outputs/apk/debug/androidApp-debug.apk ]; then
  mkdir -p "$NEUSTROY_ROOT/dist/mobile"
  cp androidApp/build/outputs/apk/debug/androidApp-debug.apk "$NEUSTROY_ROOT/dist/mobile/neustroy-android.apk"
  echo "APK: $NEUSTROY_ROOT/dist/mobile/neustroy-android.apk"
fi
