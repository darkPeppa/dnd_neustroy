#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NEUSTROY_ROOT="$(cd .. && pwd)"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$NEUSTROY_ROOT/.local/gradle}"
node ../scripts/prepare-mobile.mjs
if ! command -v xcodegen >/dev/null; then echo 'Нужен XcodeGen: brew install xcodegen' >&2; exit 1; fi
if ! xcodebuild -version >/dev/null 2>&1; then echo 'Нужен полный Xcode, затем sudo xcode-select -s /Applications/Xcode.app' >&2; exit 1; fi
NEUSTROY_VERSION="$(cat "$NEUSTROY_ROOT/VERSION")"
NEUSTROY_BUILD_NUMBER="$(node -e 'const [major,minor,patch]=process.argv[1].split(".").map(Number); process.stdout.write(String(major*1e6+minor*1e3+patch))' "$NEUSTROY_VERSION")"
cd iosApp
xcodegen generate
xcodebuild -project neustroy.xcodeproj -scheme neustroy -configuration "${NEUSTROY_IOS_CONFIGURATION:-Debug}" -destination 'generic/platform=iOS' -archivePath ../../dist/mobile/neustroy-unsigned.xcarchive CODE_SIGNING_ALLOWED=NO MARKETING_VERSION="$NEUSTROY_VERSION" CURRENT_PROJECT_VERSION="$NEUSTROY_BUILD_NUMBER" archive
echo "Unsigned archive: $NEUSTROY_ROOT/dist/mobile/neustroy-unsigned.xcarchive"
