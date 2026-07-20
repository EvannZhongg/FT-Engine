#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

case "$(uname -m)" in
  arm64)
    ARCH="arm64"
    APP_DIR="mac-arm64"
    ;;
  x86_64)
    ARCH="x64"
    APP_DIR="mac"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)"
    exit 1
    ;;
esac

npm run build:worker:mac
npm run build

if security find-identity -v -p codesigning | grep -q '"Developer ID Application:'; then
  # electron-builder uses the Developer ID identity and notarization credentials
  # from the environment/keychain when they are available.
  npx electron-builder --mac --"$ARCH"
else
  echo "Developer ID Application identity not found; creating an ad-hoc signed local build."
  npx electron-builder --mac --dir --"$ARCH"
  APP_PATH="${PROJECT_ROOT}/dist/${APP_DIR}/FT Engine.app"
  node scripts/sign-mac-adhoc.js "$APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  npx electron-builder --mac dmg --"$ARCH" --prepackaged "$APP_PATH"
fi

node scripts/rename-mac-artifacts.js
