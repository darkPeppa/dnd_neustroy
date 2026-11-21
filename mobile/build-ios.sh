#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NEUSTROY_ROOT="$(cd .. && pwd)"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$NEUSTROY_ROOT/.local/gradle}"
node ../scripts/prepare-mobile.mjs
if ! command -v xcodegen >/dev/null; then echo 'Нужен XcodeGen: brew install xcodegen' >&2; exit 1; fi
if ! xcodebuild -version >/dev/null 2>&1; then echo 'Нужен полный Xcode, затем sudo xcode-select -s /Applications/Xcode.app' >&2; exit 1; fi
cd iosApp
xcodegen generate
xcodebuild -project neustroy.xcodeproj -scheme neustroy -configuration "${NEUSTROY_IOS_CONFIGURATION:-Debug}" -destination 'generic/platform=iOS' -archivePath ../../dist/mobile/neustroy-unsigned.xcarchive CODE_SIGNING_ALLOWED=NO archive
echo "Unsigned archive: $NEUSTROY_ROOT/dist/mobile/neustroy-unsigned.xcarchive"
