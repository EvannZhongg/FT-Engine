#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 was not found."
  exit 1
fi

VENV_DIR=".venv-mac"
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements-macos.txt

rm -rf "${PROJECT_ROOT}/local-platform-worker" "${PROJECT_ROOT}/local-platform-worker.app"
python3 -m PyInstaller --noconsole --onedir --name local-platform-worker --distpath . workers/local_platform_worker/worker_entry.py

ENTITLEMENTS="${PROJECT_ROOT}/resources/entitlements-worker.plist"
WORKER_DIR="${PROJECT_ROOT}/local-platform-worker"
if [ -f "$ENTITLEMENTS" ] && [ -d "$WORKER_DIR" ]; then
  # PyInstaller onedir keeps Python.framework and extension modules beside the
  # launcher; signing the directory seals all nested native code as one unit.
  codesign --deep --force --sign - --entitlements "$ENTITLEMENTS" "$WORKER_DIR"
fi

rm -rf "${PROJECT_ROOT}/local-platform-worker.app"

deactivate
echo "macOS local platform worker build complete."
