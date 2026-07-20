# FT Engine

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is a desktop scoring application for electronic referees and competitive events. It supports free and tournament workflows, BLE/USB clickers, live scoring, OBS overlays, YouTube replay, historical reports, and CSV/SRT/ZIP exports. The local application runs on Electron, TypeScript, SQLite, and a Python Platform Worker for device and window I/O.

## Features

- Free and tournament scoring modes with single or dual referees.
- BLE and USB clicker support with reconnect handling.
- Live score display, penalties, replay, media timelines, and OBS overlay.
- Historical reports and export to CSV, SRT, and ZIP.
- Chinese, English, and Japanese interface.

## Requirements

- Node.js 22 or newer.
- Python 3.12 or newer.
- Bluetooth hardware and USB drivers for physical-device development.

The Platform Worker has OS-native dependencies, so Windows and macOS must use separate virtual environments:

- Windows: `.venv-win` with `requirements-windows.txt`.
- macOS: `.venv-mac` with `requirements-macos.txt`.
- `requirements.txt` contains only shared dependencies. Never copy a virtual environment between operating systems.

## Development

```bash
npm install
python3 -m venv .venv-mac
source .venv-mac/bin/activate
python -m pip install -r requirements-macos.txt
npm run dev
```

On Windows PowerShell:

```powershell
npm install
py -3 -m venv .venv-win
.\.venv-win\Scripts\Activate.ps1
python -m pip install -r requirements-windows.txt
npm run dev
```

`npm run build:worker:mac` and `npm run build:worker:win` create and use the matching virtual environment automatically.

The application stores local data in SQLite under Electron's user-data directory and does not require a local HTTP or WebSocket service.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
.venv-mac/bin/python -m unittest discover -s tests  # macOS
# .\.venv-win\Scripts\python.exe -m unittest discover -s tests  # Windows
```

## Packaging

```bash
npm run build:worker
npm run build:unpack
npm run build:win
npm run build:mac
```

Windows packages use NSIS; macOS packages use DMG.
The macOS build uses a Developer ID Application identity from the keychain when available. Without one, it produces an ad-hoc signed DMG for local testing; public distribution still requires Developer ID signing, notarization, and stapling.

## Documentation

- [Target architecture](docs/ARCHITECTURE_TARGET_zh.md)
- [Future goals](docs/FUTURE_GOALS_zh.md)
- [Django user service](docs/BACKEND_DJANGO_zh.md)
- [Community product boundary](docs/COMMUNITY_CONTRACT_AND_UI_SPEC_zh.md)
- [Windows and macOS adaptation](docs/PLATFORM_ADAPTATION_zh.md)

## License

Proprietary / Custom License (contact Freakthrow for licensing).
