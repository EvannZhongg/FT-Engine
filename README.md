# FT Engine - Professional Electronic Referee System

Language: [English](README.md) | [中文](README_zh.md)

FT Engine is an Electron desktop scoring application for competitive events. It supports BLE/USB clickers, SINGLE/DUAL referee modes, OBS overlays, YouTube scoring timelines, historical reports, and exports.

## Current Architecture

Route B is being introduced incrementally. The application now has one local runtime path:

- Window, overlay, device, live-match, and primary historical reads use constrained IPC.
- Electron Main's `MatchSessionService` connects the Platform Worker, TypeScript scoring domain, and atomic live SQLite event writes while publishing continuous save/worker/media status to the scoring UI.
- `CompetitionService` keeps project creation, configuration, resume, list, and deletion entirely in Main/SQLite.
- `ExportService` builds report CSV and detail ZIP/CSV/SRT from a read-only SQLite snapshot, then writes through Electron's native save dialog.
- FastAPI, Axios fallbacks, the old-project importer, shadow events, and backend-engine have been removed. Retired databases are backed up and rebuilt without importing old projects or CSV files.

See [current architecture](docs/ARCHITECTURE_CURRENT_zh.md) and the [remaining Route B plan](docs/REFACTOR_PLAN_ROUTE_B_zh.md).

## Features

- Free and Tournament modes.
- BLE/USB clickers with single and dual-device referees.
- Platform Worker BLE/USB shutdown when leaving scoring or closing the application.
- Live scoring, major penalties, waveform display, and contestant navigation.
- Transparent OBS-friendly overlay and target-window positioning.
- YouTube video scoring, playback anchors, and score overlays during replay.
- Historical reports plus CSV, SRT, and ZIP exports.
- Chinese, English, and Japanese UI.

## Development

Prerequisites:

- Node.js 22+.
- Python 3.10+; the project `.venv` is recommended.
- Bluetooth and the relevant USB drivers for physical-device development.

~~~bash
npm install
python -m pip install -r requirements.txt
npm run dev
~~~

Electron starts the Platform Worker and SQLite. Vite serves the development Renderer; the application itself does not start an HTTP or WebSocket service.

## Verification

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
python -m unittest discover -s tests
~~~

Node tests cover the local workflow, export formats, SQLite, IPC/Worker, security boundaries, and media replay. Python tests cover only the Platform Worker protocol, device service, and platform adapters.

## Packaging

~~~bash
npm run build:worker
npm run build:unpack
npm run build:win
npm run build:mac
~~~

Packages contain only the JSONL stdio `local-platform-worker` Python executable.

## Local Data

Development and packaged builds both use Electron's user-data directory.

| Data | Purpose |
| --- | --- |
| `ft-engine.db` | Sole authoritative store for projects, events, settings, and media |
| `backups/` | Read-only backup created before an incompatible schema reset |
| `exports/` | User-requested derived files |
| `logs/` | Startup and runtime logs |

Typical packaged locations are `%APPDATA%/FT Engine/` on Windows and `~/Library/Application Support/FT Engine/` on macOS.

## Key Directories

~~~text
src/main/application/            Competition, export, match, and settings services
src/main/domain/                 TypeScript scoring domain
src/main/persistence/            SQLite repository and query projections
src/main/ipc/                    Domain-specific validated IPC registration
src/main/worker/                 WorkerClient
src/preload/                     Narrow main/overlay APIs
src/shared/                      IPC and domain DTO contracts
src/renderer/                    Vue UI
workers/local_platform_worker/   BLE, USB, and window worker
tests/                           Node and Python regression tests
~~~

## Documentation

- [Current architecture and findings (Chinese)](docs/ARCHITECTURE_CURRENT_zh.md)
- [Target architecture and project structure (Chinese)](docs/ARCHITECTURE_TARGET_zh.md)
- [Remaining Route B plan (Chinese)](docs/REFACTOR_PLAN_ROUTE_B_zh.md)
- [Desktop UI and interaction target (Chinese)](docs/UI_INTERACTION_SPEC_zh.md)
- [Django user-service target (Chinese)](docs/BACKEND_DJANGO_zh.md)
- [User and community product boundary (Chinese)](docs/COMMUNITY_CONTRACT_AND_UI_SPEC_zh.md)
- [Windows and macOS adaptation](docs/PLATFORM_ADAPTATION_zh.md)

## License

Proprietary / Custom License (contact Freakthrow for licensing).

## Author

Freakthrow Team
