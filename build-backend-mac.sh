#!/bin/bash

# Exit on error
set -e

echo "Starting macOS Backend Build..."

# 1. 检查 Python 环境
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 could not be found."
    exit 1
fi

# 2. 设置虚拟环境
VENV_DIR=".venv-mac"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# 激活虚拟环境
source "$VENV_DIR/bin/activate"

echo "Installing dependencies from requirements-mac.txt in virtual environment..."
pip install --upgrade pip
pip install -r requirements-mac.txt

echo "Building binary with PyInstaller (onedir for fast startup on macOS)..."
# 使用 onedir：无每次启动解包，从 /Applications 启动时由 30s+ 降至数秒
# 输出为目录 backend-engine/ 内含 backend-engine 可执行文件
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "${SCRIPT_DIR}/backend-engine" 2>/dev/null || true
pyinstaller --noconsole --onedir --name backend-engine --distpath . server.py

# 为可执行文件注入蓝牙 entitlement 并 ad-hoc 签名（onedir 时在 backend-engine/backend-engine）
ENTITLEMENTS="${SCRIPT_DIR}/resources/entitlements-backend.plist"
BACKEND_EXE="${SCRIPT_DIR}/backend-engine/backend-engine"
if [ -f "$ENTITLEMENTS" ] && [ -f "$BACKEND_EXE" ]; then
  echo "Signing backend-engine with Bluetooth entitlement (ad-hoc)..."
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$BACKEND_EXE"
fi

# 退出虚拟环境
deactivate

echo "Build complete. 'backend-engine' binary is ready."
changes_made=true
