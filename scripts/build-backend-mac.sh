#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Starting macOS backend build..."

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 was not found."
  exit 1
fi

VENV_DIR=".venv-mac"
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

rm -rf "${PROJECT_ROOT}/backend-engine"
python -m PyInstaller --noconsole --onedir --name backend-engine --distpath . server.py

ENTITLEMENTS="${PROJECT_ROOT}/resources/entitlements-backend.plist"
BACKEND_EXE="${PROJECT_ROOT}/backend-engine/backend-engine"
if [ -f "$ENTITLEMENTS" ] && [ -f "$BACKEND_EXE" ]; then
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$BACKEND_EXE"
fi

deactivate

echo "macOS backend build complete."
