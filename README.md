# FT Engine - Professional Electronic Referee System

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is a professional electronic referee system for competitions that require accurate scoring, real-time visualization, and multi-device coordination. It combines BLE clicker hardware, real-time waveform analysis, OBS-friendly overlays, and full match data management.


## Key Features
- **Multi-mode**: Free Mode and Tournament Mode
- **BLE hardware**: single or dual clicker setup with low-latency sync
- **Real-time visualization**: waveform widget for scoring trends
- **Streaming overlay**: transparent overlay for OBS or game capture
- **Data management**: CSV raw data, TXT logs, and SRT subtitle export
- **Internationalization**: built-in Chinese, English, and Japanese

## Development Setup
Prerequisites:
- Node.js 18+
- Python 3.9+
- Bluetooth enabled on the host machine

All commands below run inside [`FT-Engine/`](./FT-Engine).

### 1. Install Dependencies
```bash
npm install
python -m pip install -r requirements.txt
```

### 2. Development
```bash
npm run dev
```

In development mode, Electron starts the Python backend automatically from `server.py`.

### 3. Build Backend Only
```bash
# Auto-select script for current platform
npm run build:backend

# Windows
npm run build:backend:win

# macOS
npm run build:backend:mac
```

What these do:
- `build:backend:win`: builds `backend-engine.exe` with PyInstaller
- `build:backend:mac`: builds `backend-engine/` as a macOS `onedir` backend and applies Bluetooth entitlements

### 4. Build Application Packages
```bash
# Windows installer
npm run build:win

# macOS DMG
npm run build:mac

# Unpacked app for local inspection
npm run build:unpack
```

## Configuration and Data
- Runtime config file: `FT-Engine/config.yaml`
- App settings in development: `FT-Engine/app_settings.json`
- Match data in development: `FT-Engine/match_data/`
- Packaged app settings and match data: system user-data directory

Typical packaged data locations:
- Windows: `%APPDATA%/FT Engine/`
- macOS: `~/Library/Application Support/FT Engine/`

## Project Structure
```text
FT_Engine/
├── README.md
├── README_zh.md
└── FT-Engine/
    ├── server.py
    ├── config.yaml
    ├── requirements.txt
    ├── package.json
    ├── resources/
    │   ├── icon.png
    │   ├── entitlements.mac.plist
    │   ├── entitlements-backend.plist
    │   └── installer.nsh
    ├── scripts/
    │   ├── build-backend.js
    │   ├── build-backend-win.ps1
    │   ├── build-backend-mac.sh
    │   └── rename-mac-artifacts.js
    ├── src/
    │   ├── main/
    │   │   ├── index.js
    │   │   └── platform.js
    │   ├── preload/
    │   │   └── index.js
    │   └── renderer/
    │       ├── index.html
    │       └── src/
    │           ├── components/
    │           ├── locales/
    │           ├── stores/
    │           ├── App.vue
    │           └── main.js
    └── utils/
        ├── app_settings.py
        ├── exporter.py
        ├── platform.py
        ├── runtime.py
        └── storage.py
```

## Important Shared Modules
- `src/main/platform.js`: platform-specific Electron startup and backend launch behavior
- `server.py`: shared FastAPI + BLE backend
- `utils/platform.py`: BLE heartbeat policy by platform
- `utils/runtime.py`: config path and writable data-root resolution
- `scripts/`: build helpers used during packaging, not bundled as user-facing runtime features

## Documentation
- Backend API: [docs/BACKEND_API.md](docs/BACKEND_API.md)
- BLE Protocol: [docs/BLE_PROTOCOL.md](docs/BLE_PROTOCOL.md)

## License
This project is licensed under the [MIT License](LICENSE).

## Author
Freakthrow Team
